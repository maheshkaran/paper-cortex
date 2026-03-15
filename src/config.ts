import os from "node:os";
import path from "node:path";

export interface Config {
	inboxDir: string;
	libraryDir: string;
	obsidianVaultDir: string;
	obsidianMindMapDir: string;
	obsidianPapersDir: string;
	obsidianConceptsDir: string;
	paperIndexFile: string;
	ideaLogFile: string;
	cleanupEveryDays: number;
	modelId: string;
	maxReorgMoves: number;
	reorgConfidence: number;
	stableMs: number;
}

function expandHome(p: string): string {
	if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
	return p;
}

function envPath(name: string, defaultValue: string): string {
	const v = process.env[name];
	return expandHome(v && v.trim().length > 0 ? v : defaultValue);
}

function envNumber(name: string, defaultValue: number): number {
	const v = process.env[name];
	if (!v) return defaultValue;
	const n = Number(v);
	return Number.isFinite(n) ? n : defaultValue;
}

export function getConfig(): Config {
	const inboxDir = envPath(
		"PAPER_CORTEX_INBOX_DIR",
		"~/Google Drive/My Drive/Saved from Chrome",
	);
	const libraryDir = envPath("PAPER_CORTEX_LIBRARY_DIR", "~/Google Drive/My Drive/Papers");
	const obsidianVaultDir = envPath("PAPER_CORTEX_OBSIDIAN_VAULT_DIR", "~/MIT:WHOI/Research");
	const obsidianMindMapDir = path.join(obsidianVaultDir, "Mind_Map");
	const obsidianPapersDir = path.join(obsidianMindMapDir, "Papers");
	const obsidianConceptsDir = path.join(obsidianMindMapDir, "Concepts");
	const paperIndexFile = path.join(obsidianMindMapDir, "Paper_Index.md");
	const ideaLogFile = envPath("PAPER_CORTEX_IDEA_LOG_FILE", path.join(obsidianVaultDir, "Idea Log.md"));

	return {
		inboxDir,
		libraryDir,
		obsidianVaultDir,
		obsidianMindMapDir,
		obsidianPapersDir,
		obsidianConceptsDir,
		paperIndexFile,
		ideaLogFile,
		cleanupEveryDays: envNumber("PAPER_CORTEX_CLEANUP_EVERY_DAYS", 10),
		modelId: process.env.PAPER_CORTEX_MODEL?.trim() || "gpt-4.1-mini",
		maxReorgMoves: envNumber("PAPER_CORTEX_MAX_REORG_MOVES", 20),
		reorgConfidence: envNumber("PAPER_CORTEX_REORG_CONFIDENCE", 0.85),
		stableMs: envNumber("PAPER_CORTEX_STABLE_MS", 1500),
	};
}
