import path from "node:path";
import fs from "node:fs/promises";
import { atomicWriteUtf8, ensureDir, exists, readUtf8 } from "./fs-utils.js";

export interface PaperNoteInput {
	slug: string;
	title: string;
	authors?: string;
	year?: string;
	topicFolder: string;
	pdfBasename: string;
	summary: string;
	concepts: string[]; // Concept note names, e.g. Measure_Theory
}

export function wikiLink(name: string): string {
	return `[[${name}]]`;
}

export async function ensureConceptNotes(
	conceptsDir: string,
	concepts: string[],
	opts?: { maxNew?: number },
): Promise<string[]> {
	await ensureDir(conceptsDir);
	const maxNew = opts?.maxNew ?? Number.POSITIVE_INFINITY;
	let newCreated = 0;
	const kept: string[] = [];
	const seen = new Set<string>();
	for (const concept of concepts) {
		if (seen.has(concept)) continue;
		seen.add(concept);

		const file = path.join(conceptsDir, `${concept}.md`);
		if (await exists(file)) {
			kept.push(concept);
			continue;
		}

		if (newCreated >= maxNew) continue;

		const content = `# ${concept.replace(/_/g, " ")}

## Summary

(Stub)\n`;
		await atomicWriteUtf8(file, `${content}\n`);
		newCreated++;
		kept.push(concept);
	}

	return kept;
}

export async function upsertPaperNote(papersDir: string, input: PaperNoteInput): Promise<void> {
	await ensureDir(papersDir);
	const filePath = path.join(papersDir, `${input.slug}.md`);

	const sourceLine = `- File: \`/${input.topicFolder}/${input.pdfBasename}\``;

	const conceptLinks = input.concepts.map(wikiLink).join(" ");

	const content = `# ${input.title}

## Source

${sourceLine}
${input.authors ? `- Author: ${input.authors}\n` : ""}${input.year ? `- Year: ${input.year}\n` : ""}
## Core Summary

${input.summary.trim()}

## Themes

${conceptLinks || "(none)"}
`;

	await atomicWriteUtf8(filePath, `${content}\n`);
}

export async function updatePaperIndex(
	indexFile: string,
	slug: string,
	topicFolder: string,
	pdfBasename: string,
): Promise<void> {
	await ensureDir(path.dirname(indexFile));
	const entryLine = `- [[${slug}]] — \`${topicFolder}/${pdfBasename}\``;

	let content = "# Paper Index\n\n";
	if (await exists(indexFile)) {
		content = await readUtf8(indexFile);
	}

	const lines = content.split(/\r?\n/);
	let replaced = false;
	const out: string[] = [];
	for (const l of lines) {
		if (l.startsWith(`- [[${slug}]] — `)) {
			out.push(entryLine);
			replaced = true;
			continue;
		}
		out.push(l);
	}

	if (!replaced) {
		if (out.length > 0 && out[out.length - 1]?.trim() !== "") out.push("");
		out.push(entryLine);
	}

	// Update "Total papers indexed" if present.
	const entryCount = out.filter((l) => /^- \[\[[^\]]+\]\] — `/.test(l)).length;
	for (let i = 0; i < out.length; i++) {
		if (/^Total papers indexed:\s+\*\*\d+\*\*/.test(out[i] ?? "")) {
			out[i] = `Total papers indexed: **${entryCount}**`;
			break;
		}
	}

	await atomicWriteUtf8(indexFile, `${out.join("\n")}\n`);
}

export async function updatePaperNoteSourcePath(paperNotePath: string, topicFolder: string, pdfBasename: string): Promise<void> {
	if (!(await exists(paperNotePath))) return;
	const raw = await readUtf8(paperNotePath);
	const lines = raw.split(/\r?\n/);
	const newLine = `- File: \`/${topicFolder}/${pdfBasename}\``;

	const out: string[] = [];
	let replaced = false;
	for (const l of lines) {
		if (l.startsWith("- File: `/") && !replaced) {
			out.push(newLine);
			replaced = true;
			continue;
		}
		out.push(l);
	}
	await atomicWriteUtf8(paperNotePath, `${out.join("\n")}\n`);
}

export async function listExistingPaperSlugs(papersDir: string): Promise<Set<string>> {
	const set = new Set<string>();
	if (!(await exists(papersDir))) return set;
	const entries = await fs.readdir(papersDir);
	for (const e of entries) {
		if (!e.endsWith(".md")) continue;
		set.add(e.slice(0, -3));
	}
	return set;
}
