import fs from "node:fs/promises";
import path from "node:path";

import type { Config } from "./config.js";
import { AgentState } from "./state.js";
import { atomicWriteUtf8, ensureDir, exists, readUtf8 } from "./fs-utils.js";
import { walkFiles } from "./walk.js";

export interface CleanupResult {
	deletedPaperSlugs: string[];
	deletedPaperNotes: number;
	updatedFiles: number;
	removedLinks: number;
}

function parsePaperSource(content: string): { topic: string; pdfBasename: string } | null {
	// Example: - File: `/Mathematical_Foundations/measure_theory.pdf`
	const m = content.match(/^- File: `\/([^/`]+)\/([^`]+\.pdf)`/m);
	if (!m) return null;
	return { topic: m[1] ?? "", pdfBasename: m[2] ?? "" };
}

function buildDeadLinkRegex(slugs: string[]): RegExp | null {
	if (slugs.length === 0) return null;
	// Slugs are lowercase_underscore. Escape anyway.
	const escaped = slugs.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const alternation = escaped.sort((a, b) => b.length - a.length).join("|");
	// Matches [[slug]], [[slug|alias]], [[slug#heading]], [[slug#heading|alias]]
	return new RegExp(`\\[\\[(?:${alternation})(?:[#|][^\\]]+)?\\]\\]`, "g");
}

function stripDeadLinksFromMarkdown(content: string, deadLinkRe: RegExp): { content: string; removed: number } {
	const lines = content.split(/\r?\n/);
	let inFence = false;
	let removed = 0;
	const out: string[] = [];

	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```")) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}

		const before = line;
		const after = before.replace(deadLinkRe, () => {
			removed++;
			return "";
		});

		// Clean up empty agent-added lines like "  - Related papers: "
		const cleaned = after.replace(/\s+$/g, "");
		const isEmptyRelated = /^\s*-\s*(Related papers|Related concepts|Suggested concepts to explore):\s*$/.test(cleaned);
		if (isEmptyRelated) {
			continue;
		}

		out.push(after);
	}

	return { content: out.join("\n"), removed };
}

async function moveToDeletedFolder(papersDir: string, slug: string): Promise<boolean> {
	const src = path.join(papersDir, `${slug}.md`);
	if (!(await exists(src))) return false;

	const deletedDir = path.join(papersDir, "_Deleted");
	await ensureDir(deletedDir);

	let dst = path.join(deletedDir, `${slug}.md`);
	if (await exists(dst)) {
		dst = path.join(deletedDir, `${slug}.${Date.now()}.md`);
	}

	await fs.rename(src, dst);
	return true;
}

async function rewritePaperIndexRemoveSlugs(indexFile: string, remove: Set<string>): Promise<boolean> {
	if (!(await exists(indexFile))) return false;
	const raw = await readUtf8(indexFile);
	const lines = raw.split(/\r?\n/);
	const out: string[] = [];
	let changed = false;

	for (const line of lines) {
		const m = /^- \[\[([^\]]+)\]\] — `/.exec(line);
		if (m) {
			const slug = m[1] ?? "";
			if (remove.has(slug)) {
				changed = true;
				continue;
			}
		}
		out.push(line);
	}

	if (!changed) return false;

	// Update count if present.
	const entryCount = out.filter((l) => /^- \[\[[^\]]+\]\] — `/.test(l)).length;
	for (let i = 0; i < out.length; i++) {
		if (/^Total papers indexed:\s+\*\*\d+\*\*/.test(out[i] ?? "")) {
			out[i] = `Total papers indexed: **${entryCount}**`;
			break;
		}
	}

	await atomicWriteUtf8(indexFile, `${out.join("\n")}\n`);
	return true;
}

export async function runCleanupIfDue(params: {
	config: Config;
	state: AgentState;
	cleanupEveryDays: number;
}): Promise<CleanupResult | null> {
	const last = params.state.getLastCleanupTimestamp();
	const intervalMs = params.cleanupEveryDays * 24 * 60 * 60 * 1000;
	if (last !== null && Date.now() - last < intervalMs) return null;

	const result = await runCleanup({ config: params.config });
	params.state.setLastCleanupTimestamp(Date.now());
	await params.state.save();
	return result;
}

export async function runCleanup(params: { config: Config }): Promise<CleanupResult> {
	const { config } = params;

	// 1) Identify paper slugs whose source PDF is missing.
	const paperEntries = await fs.readdir(config.obsidianPapersDir, { withFileTypes: true });
	const deletedSlugs: string[] = [];

	for (const e of paperEntries) {
		if (!e.isFile() || !e.name.endsWith(".md")) continue;
		if (e.name === "_Deleted") continue;
		const slug = e.name.slice(0, -3);
		const notePath = path.join(config.obsidianPapersDir, e.name);
		const raw = await readUtf8(notePath);
		const src = parsePaperSource(raw);
		if (!src) continue;
		const pdfPath = path.join(config.libraryDir, src.topic, src.pdfBasename);
		if (!(await exists(pdfPath))) {
			deletedSlugs.push(slug);
		}
	}

	const removeSet = new Set(deletedSlugs);
	let deletedPaperNotes = 0;
	for (const slug of deletedSlugs) {
		const moved = await moveToDeletedFolder(config.obsidianPapersDir, slug);
		if (moved) deletedPaperNotes++;
	}

	// 2) Remove entries from Paper_Index.md
	await rewritePaperIndexRemoveSlugs(config.paperIndexFile, removeSet);

	// 3) Sweep through all Mind_Map markdown files and strip dead links.
	const deadLinkRe = buildDeadLinkRegex(deletedSlugs);
	let updatedFiles = 0;
	let removedLinks = 0;

	if (deadLinkRe) {
		for await (const filePath of walkFiles(config.obsidianMindMapDir)) {
			if (!filePath.endsWith(".md")) continue;
			// Keep deleted notes intact.
			if (filePath.includes(`${path.sep}Papers${path.sep}_Deleted${path.sep}`)) continue;

			const raw = await readUtf8(filePath);
			const stripped = stripDeadLinksFromMarkdown(raw, deadLinkRe);
			if (stripped.removed === 0) continue;

			removedLinks += stripped.removed;
			updatedFiles++;
			await atomicWriteUtf8(filePath, `${stripped.content}\n`);
		}
	}

	return {
		deletedPaperSlugs: deletedSlugs,
		deletedPaperNotes,
		updatedFiles,
		removedLinks,
	};
}
