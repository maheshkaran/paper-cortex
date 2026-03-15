import fs from "node:fs/promises";

import { atomicWriteUtf8, exists, readUtf8 } from "./fs-utils.js";
import { AgentState } from "./state.js";
import { completeText, getOpenAIModel, parseJson } from "./llm.js";

export interface IdeaSuggestionResult {
	papers: string[];
	concepts: string[];
	suggestedConcepts: string[];
}

function isTopLevelBullet(line: string): boolean {
	return /^-\s+\S/.test(line);
}

function extractIdeaText(line: string): string {
	return line.replace(/^-\s+/, "").trim();
}

function hasAgentSuggestions(blockLines: string[]): boolean {
	return blockLines.some((l) => /^\s{2}-\s+(Related papers|Related concepts|Suggested concepts to explore):/.test(l));
}

function uniqKeepOrder(items: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const it of items) {
		if (seen.has(it)) continue;
		seen.add(it);
		out.push(it);
	}
	return out;
}

function formatWikiLinks(names: string[]): string {
	return names.map((n) => `[[${n}]]`).join(" ");
}

async function listNoteNames(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name.slice(0, -3));
}

export async function suggestForIdea(params: {
	modelId: string;
	idea: string;
	paperSlugs: string[];
	concepts: string[];
}): Promise<IdeaSuggestionResult> {
	const model = getOpenAIModel(params.modelId);

	const prompt = `You are helping annotate an idea log with relevant resources.

Idea:
${params.idea}

Candidate papers (you may ONLY pick from this list, by slug):
${params.paperSlugs.join(", ")}

Candidate concepts (you may ONLY pick from this list, by exact concept name):
${params.concepts.join(", ")}

Return ONLY JSON:
{
  "papers": string[],
  "concepts": string[],
  "suggestedConcepts": string[]
}

Rules:
- papers: strong matches only (max 6)
- concepts: strong matches only (max 10)
- if there are no strong matches, leave papers/concepts empty and instead populate suggestedConcepts (max 8, Title_Case_Underscore).`;

	const text = await completeText(model, prompt);
	const parsed = parseJson<IdeaSuggestionResult>(text);

	return {
		papers: uniqKeepOrder((parsed.papers ?? []).map((s) => s.trim()).filter(Boolean)).slice(0, 6),
		concepts: uniqKeepOrder((parsed.concepts ?? []).map((s) => s.trim()).filter(Boolean)).slice(0, 10),
		suggestedConcepts: uniqKeepOrder((parsed.suggestedConcepts ?? []).map((s) => s.trim()).filter(Boolean)).slice(0, 8),
	};
}

export async function annotateIdeaLogFile(params: {
	ideaLogPath: string;
	state: AgentState;
	modelId: string;
	papersDir: string;
	conceptsDir: string;
}): Promise<void> {
	if (!(await exists(params.ideaLogPath))) return;
	const raw = await readUtf8(params.ideaLogPath);
	const lines = raw.split(/\r?\n/);

	const paperSlugs = await listNoteNames(params.papersDir);
	const concepts = await listNoteNames(params.conceptsDir);

	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!isTopLevelBullet(line)) continue;

		const idea = extractIdeaText(line);
		if (!idea) continue;

		// Determine block range
		let j = i + 1;
		for (; j < lines.length; j++) {
			const next = lines[j] ?? "";
			if (isTopLevelBullet(next)) break;
		}
		const block = lines.slice(i, j);
		if (hasAgentSuggestions(block)) {
			continue;
		}

		if (params.state.hasProcessedIdea(idea)) {
			continue;
		}

		const suggestion = await suggestForIdea({
			modelId: params.modelId,
			idea,
			paperSlugs,
			concepts,
		});

		const insertion: string[] = [];
		if (suggestion.papers.length > 0) {
			insertion.push(`  - Related papers: ${formatWikiLinks(suggestion.papers)}`);
		}
		if (suggestion.concepts.length > 0) {
			insertion.push(`  - Related concepts: ${formatWikiLinks(suggestion.concepts)}`);
		}
		if (suggestion.papers.length === 0 && suggestion.concepts.length === 0) {
			if (suggestion.suggestedConcepts.length > 0) {
				insertion.push(
					`  - Suggested concepts to explore: ${formatWikiLinks(suggestion.suggestedConcepts)}`,
				);
			} else {
				insertion.push("  - Suggested concepts to explore: (none)");
			}
		}

		if (insertion.length > 0) {
			// Insert at end of the idea block.
			lines.splice(j, 0, ...insertion);
			changed = true;
			params.state.markIdeaProcessed(idea);

			// Move cursor forward to skip over inserted lines.
			i = j + insertion.length - 1;
		}
	}

	if (!changed) return;
	await atomicWriteUtf8(params.ideaLogPath, `${lines.join("\n")}\n`);
	await params.state.save();
}
