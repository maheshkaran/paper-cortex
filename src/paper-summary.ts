import path from "node:path";
import fs from "node:fs/promises";
import { atomicWriteUtf8, exists, readUtf8 } from "./fs-utils.js";
import { getOpenAIModel, completeText } from "./llm.js";
import { pdfToTextPreview } from "./pdftools.js";

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

function extractTitle(content: string): string {
	const firstLine = content.split(/\r?\n/)[0] ?? "";
	return parseH1Title(firstLine.trim()) ?? "Untitled";
}

function extractSourceRelPath(content: string): string | null {
	// Created by upsertPaperNote(): - File: `/<Topic>/<file>.pdf`
	const m = content.match(/^- File:\s+`\/([^`]+)`\s*$/m);
	return m?.[1]?.trim() ? m[1].trim() : null;
}

function hasNonEmptyMathSummary(content: string): boolean {
	const m = content.match(/^##\s+Mathematical Summary\s*$/m);
	if (!m) return false;

	const lines = content.split(/\r?\n/);
	const startIdx = lines.findIndex((l) => /^##\s+Mathematical Summary\s*$/.test(l));
	if (startIdx < 0) return false;

	const after = lines.slice(startIdx + 1);
	const body: string[] = [];
	for (const l of after) {
		if (/^##\s+/.test(l)) break;
		body.push(l);
	}

	return nonEmptyLines(body.join("\n")).length > 0 && !/\(autofill pending\)/i.test(body.join("\n"));
}

function upsertMathSummarySection(content: string, mathSummaryMarkdown: string): string {
	const lines = content.split(/\r?\n/);
	const heading = "## Mathematical Summary";

	const idx = lines.findIndex((l) => /^##\s+Mathematical Summary\s*$/.test(l));
	if (idx >= 0) {
		// Replace existing section body up to next H2.
		const out: string[] = [];
		out.push(...lines.slice(0, idx));
		out.push(heading);
		out.push("");
		out.push(...mathSummaryMarkdown.trim().split(/\r?\n/));
		out.push("");

		let j = idx + 1;
		while (j < lines.length && !/^##\s+/.test(lines[j] ?? "")) j++;
		out.push(...lines.slice(j));
		return out.join("\n").replace(/\n{3,}/g, "\n\n");
	}

	// Insert before Themes if present; otherwise append.
	const themesIdx = lines.findIndex((l) => /^##\s+Themes\s*$/.test(l));
	const insertAt = themesIdx >= 0 ? themesIdx : lines.length;

	const out: string[] = [];
	out.push(...lines.slice(0, insertAt));
	if (out.length > 0 && (out[out.length - 1] ?? "").trim() !== "") out.push("");
	out.push(heading);
	out.push("");
	out.push(...mathSummaryMarkdown.trim().split(/\r?\n/));
	out.push("");
	out.push(...lines.slice(insertAt));
	return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function fillPaperMathSummaryIfMissing(params: {
	paperNotePath: string;
	libraryDir: string;
	modelId: string;
	pages: number;
}): Promise<void> {
	if (!(await exists(params.paperNotePath))) return;
	const raw = await readUtf8(params.paperNotePath);
	if (hasNonEmptyMathSummary(raw)) return;

	const title = extractTitle(raw);
	const rel = extractSourceRelPath(raw);
	if (!rel) {
		console.log(`[paper-summary] skip (no source pdf path found): ${params.paperNotePath}`);
		return;
	}

	const pdfPath = path.join(params.libraryDir, rel);
	if (!(await exists(pdfPath))) {
		console.log(`[paper-summary] skip (pdf missing): note=${params.paperNotePath} pdf=${pdfPath}`);
		return;
	}

	const requestedPages = Math.max(0, params.pages);
	const preview = await pdfToTextPreview(pdfPath, requestedPages);
	const pagesLabel = requestedPages > 0 ? String(requestedPages) : "all";

	const model = getOpenAIModel(params.modelId);
	const prompt = `Write a detailed mathematical/technical summary for the following research paper.

Audience: a strong senior undergraduate studying mathematics, computer science, and robotics.

Constraints:
- Output MUST be markdown.
- Use LaTeX for math (inline $...$ and display $$...$$).
- Do NOT include a top-level "# Title" heading or "## Mathematical Summary" heading.
- Be precise and technical; avoid high-level fluff.
- If a detail is not supported by the provided text, say "(not specified in excerpt)" rather than guessing.

Paper title: ${title}
PDF path: ${pdfPath}

Paper note context (may be brief/incomplete):
---
${raw.slice(0, 4_000)}
---

PDF text excerpt (first ${pagesLabel} page(s)):
---
${preview.slice(0, 18_000)}
---

Write the section body for "## Mathematical Summary" with:
- Problem + formalization (variables, spaces, objective, constraints)
- Model/assumptions
- Main results (theorems/guarantees) and what they mean
- Algorithm/method (pseudocode-like bullets ok)
- Key equations and definitions
- Limitations/failure modes
- How to use it in robotics/ML (concrete)

Return only the markdown body (no surrounding code fences).`;

	console.log(`[paper-summary] LLM request: note=${path.basename(params.paperNotePath)}, model=${params.modelId}, promptChars=${prompt.length}`);
	const body = (await completeText(model, prompt)).trim();
	const updated = upsertMathSummarySection(raw, body);
	await atomicWriteUtf8(params.paperNotePath, `${updated.trim()}\n`);
	console.log(`[paper-summary] wrote math summary: ${params.paperNotePath}`);
}

export async function backfillPaperMathSummaries(params: {
	papersDir: string;
	libraryDir: string;
	modelId: string;
	pages: number;
	maxNotes: number;
}): Promise<{ processed: number; updated: number }> {
	const entries = await fs.readdir(params.papersDir, { withFileTypes: true });
	const notes = entries
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => path.join(params.papersDir, e.name));

	let processed = 0;
	let updated = 0;
	for (const notePath of notes) {
		if (processed >= Math.max(0, params.maxNotes)) break;
		processed++;

		const before = await readUtf8(notePath);
		const had = hasNonEmptyMathSummary(before);
		await fillPaperMathSummaryIfMissing({
			paperNotePath: notePath,
			libraryDir: params.libraryDir,
			modelId: params.modelId,
			pages: params.pages,
		});
		const after = await readUtf8(notePath);
		const hasNow = hasNonEmptyMathSummary(after);
		if (!had && hasNow) updated++;
	}

	return { processed, updated };
}

