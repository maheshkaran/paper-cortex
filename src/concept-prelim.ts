import path from "node:path";
import fs from "node:fs/promises";

import { atomicWriteUtf8, exists, readUtf8 } from "./fs-utils.js";
import { getOpenAIModel, completeText } from "./llm.js";

function nonEmptyLines(content: string): string[] {
	return content
		.split(/\r?\n/)
		.map((l) => l.trimEnd())
		.filter((l) => l.trim().length > 0);
}

function parseH1Title(line: string): string | null {
	const m = /^#\s+(.+)$/.exec(line ?? "");
	return m?.[1]?.trim() ? m[1].trim() : null;
}

function isTitleOnlyConceptNote(content: string): { ok: boolean; title: string } {
	const lines = nonEmptyLines(content);
	if (lines.length !== 1) return { ok: false, title: "" };
	const title = parseH1Title(lines[0] ?? "");
	if (!title) return { ok: false, title: "" };
	return { ok: true, title };
}

// Matches the stub created by ensureConceptNotes() in src/obsidian.ts
function isStubConceptNote(content: string): { ok: boolean; title: string } {
	const lines = nonEmptyLines(content);
	if (lines.length !== 3) return { ok: false, title: "" };
	const title = parseH1Title(lines[0] ?? "");
	if (!title) return { ok: false, title: "" };
	if ((lines[1] ?? "") !== "## Summary") return { ok: false, title: "" };
	if (!/^\(stub\)$/i.test(lines[2] ?? "")) return { ok: false, title: "" };
	return { ok: true, title };
}

function isEmptyConceptNote(content: string): boolean {
	return nonEmptyLines(content).length === 0;
}

async function listNoteNames(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name.slice(0, -3));
}

async function listPaperSlugsWithTitles(papersDir: string): Promise<Array<{ slug: string; title: string }>> {
	const entries = await fs.readdir(papersDir, { withFileTypes: true });
	const out: Array<{ slug: string; title: string }> = [];
	for (const e of entries) {
		if (!e.isFile() || !e.name.endsWith(".md")) continue;
		const slug = e.name.slice(0, -3);
		const raw = await readUtf8(path.join(papersDir, e.name));
		const firstLine = raw.split(/\r?\n/)[0] ?? "";
		const m = /^#\s+(.+)$/.exec(firstLine.trim());
		out.push({ slug, title: m?.[1]?.trim() ?? slug });
	}
	return out;
}

export async function fillConceptPreliminariesIfTitleOnly(params: {
	conceptFilePath: string;
	conceptsDir: string;
	papersDir: string;
	modelId: string;
}): Promise<void> {
	if (!(await exists(params.conceptFilePath))) return;
	const content = await readUtf8(params.conceptFilePath);

	const conceptName = path.basename(params.conceptFilePath).replace(/\.md$/, "");
	const derivedTitle = conceptName.replace(/_/g, " ");

	const titleOnly = isTitleOnlyConceptNote(content);
	const stub = titleOnly.ok ? { ok: false, title: "" } : isStubConceptNote(content);
	const empty = !titleOnly.ok && !stub.ok && isEmptyConceptNote(content);

	const match = titleOnly.ok ? titleOnly : stub.ok ? stub : empty ? { ok: true, title: derivedTitle } : { ok: false, title: "" };
	if (!match.ok) {
		console.log(`[concept-prelim] skip (not title-only/stub/empty): ${params.conceptFilePath}`);
		return;
	}

	console.log(`[concept-prelim] filling preliminaries for ${conceptName} (mode=${titleOnly.ok ? "title-only" : stub.ok ? "stub" : "empty"})`);
	const existingConcepts = await listNoteNames(params.conceptsDir);
	const papers = await listPaperSlugsWithTitles(params.papersDir);

	const model = getOpenAIModel(params.modelId);

	const prompt = `Write mathematical preliminaries for the Obsidian concept note: ${conceptName}

Constraints:
- Output MUST be markdown.
- Use LaTeX for math notation. Equations should be wrapped in \`$\` or \`$$\` blocks.
- Do NOT include the top-level title (the agent will ensure the file starts with a single # Title line).
- Use wiki links like [[Like_This]].
- Only link to concepts from this list when you reference them:
${existingConcepts.join(", ")}
- Only link to papers from this list when you reference them (format: [[slug]]):
${papers.map((p) => `${p.slug} (${p.title})`).join("; ")}

Goal:
- Provide prerequisites, definitions, key theorems/results, common notation, and how it connects to robotics/ML when relevant.
- Keep it concise but useful.
- Do NOT provide a final summary describing the high-level concept
- Keep the results highly technical, like an excerpt from a textbook.
- Only add bullets at the end for further reading

Return only the markdown body.`;

	console.log(`[concept-prelim] LLM request: concept=${conceptName}, model=${params.modelId}, promptChars=${prompt.length}`);
	const body = (await completeText(model, prompt)).trim();
	const final = `# ${match.title}\n\n${body}\n`;
	await atomicWriteUtf8(params.conceptFilePath, final);
	console.log(`[concept-prelim] wrote filled concept note: ${params.conceptFilePath} (chars=${final.length})`);
}
