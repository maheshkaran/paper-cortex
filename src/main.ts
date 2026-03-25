import path from "node:path";
import fs from "node:fs/promises";
import chokidar from "chokidar";
import dotenv from "dotenv";

import { getConfig, type Config } from "./config.js";
import { PaperCache } from "./cache.js";
import { pdfInfo, pdfToTextPreview } from "./pdftools.js";
import { classifyPaper, shouldMoveToNewTopic } from "./classify.js";
import { ensureDir, exists } from "./fs-utils.js";
import { ensureTopicFolder, listAllPapers, listTopicFolders, movePdfToTopic } from "./library.js";
import { isValidPaperSlug, slugifyPaper } from "./slug.js";
import {
	ensureConceptNotes,
	listExistingPaperSlugs,
	updatePaperIndex,
	updatePaperNoteSourcePath,
	upsertPaperNote,
} from "./obsidian.js";
import { fillConceptPreliminariesIfTitleOnly } from "./concept-prelim.js";
import { annotateIdeaLogFile } from "./idea-log.js";
import { AgentState } from "./state.js";
import { runCleanupIfDue } from "./cleanup.js";

function ts(): string {
	return new Date().toISOString();
}

function logWatcher(msg: string): void {
	console.log(`[${ts()}] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function waitForStableFile(filePath: string, stableMs: number): Promise<void> {
	let lastSize = -1;
	let stableFor = 0;
	while (stableFor < stableMs) {
		const stat = await fs.stat(filePath);
		if (stat.size === lastSize) {
			stableFor += 250;
		} else {
			lastSize = stat.size;
			stableFor = 0;
		}
		await sleep(250);
	}
}

async function uniqueSlug(desired: string, existing: Set<string>): Promise<string> {
	let base = desired;
	if (!isValidPaperSlug(base)) base = slugifyPaper(base);
	let slug = base;
	let i = 2;
	while (existing.has(slug)) {
		slug = `${base}_${i}`;
		i++;
	}
	return slug;
}

async function uniqueBasename(dstDir: string, slug: string): Promise<string> {
	let candidate = `${slug}.pdf`;
	let i = 2;
	while (await exists(path.join(dstDir, candidate))) {
		candidate = `${slug}_${i}.pdf`;
		i++;
	}
	return candidate;
}

async function reorganizeForNewTopic(args: {
	newTopic: string;
	config: Config;
	cache: PaperCache;
}): Promise<void> {
	const { config, newTopic, cache } = args;
	console.log(`[reorg] considering moves into new topic: ${newTopic}`);

	const { path: newTopicPath } = await ensureTopicFolder(config.libraryDir, newTopic);
	const papers = await listAllPapers(config.libraryDir);

	let moves = 0;
	for (const paper of papers) {
		if (moves >= config.maxReorgMoves) break;
		if (paper.topic === newTopic) continue;

		const { sha256, size, mtimeMs } = await PaperCache.sha256File(paper.pdfPath);
		let entry = cache.get(sha256);
		if (!entry || entry.size !== size || entry.mtimeMs !== mtimeMs) {
			const info = await pdfInfo(paper.pdfPath);
			const previewText = await pdfToTextPreview(paper.pdfPath, 2);
			entry = { sha256, pdfPath: paper.pdfPath, size, mtimeMs, previewText, pdfTitle: info.title };
			cache.set(entry);
		}

		const decision = await shouldMoveToNewTopic({
			modelId: config.modelId,
			newTopic,
			previewText: entry.previewText,
			currentTopic: paper.topic,
			slug: paper.slug,
		});

		if (!decision.move || decision.confidence < config.reorgConfidence) continue;

		if (await exists(path.join(newTopicPath, paper.pdfBasename))) {
			console.log(`[reorg] skip ${paper.slug} (basename conflict in ${newTopic}): ${paper.pdfBasename}`);
			continue;
		}

		await fs.rename(paper.pdfPath, path.join(newTopicPath, paper.pdfBasename));
		moves++;
		console.log(
			`[reorg] moved ${paper.slug} from ${paper.topic} -> ${newTopic} (conf=${decision.confidence.toFixed(2)}): ${decision.reason}`,
		);

		const notePath = path.join(config.obsidianPapersDir, `${paper.slug}.md`);
		await updatePaperNoteSourcePath(notePath, newTopic, paper.pdfBasename);
		await updatePaperIndex(config.paperIndexFile, paper.slug, newTopic, paper.pdfBasename);
	}

	await cache.save();
	console.log(`[reorg] completed, moves=${moves}`);
}

async function ingestPdf(args: { pdfPath: string; config: Config; cache: PaperCache }): Promise<void> {
	const { pdfPath, config, cache } = args;

	console.log(`[ingest] new pdf: ${pdfPath}`);
	await waitForStableFile(pdfPath, config.stableMs);

	const { sha256, size, mtimeMs } = await PaperCache.sha256File(pdfPath);
	const cached = cache.get(sha256);

	let previewText = cached?.previewText;
	let titleHint = cached?.pdfTitle;

	if (!previewText || cached?.size !== size || cached?.mtimeMs !== mtimeMs) {
		const info = await pdfInfo(pdfPath);
		titleHint = info.title;
		previewText = await pdfToTextPreview(pdfPath, 2);
		cache.set({ sha256, pdfPath, mtimeMs, size, previewText, pdfTitle: titleHint });
		await cache.save();
	}

	const topics = (await listTopicFolders(config.libraryDir)).map((t) => t.name);
	const originalFilename = path.basename(pdfPath);

	const classification = await classifyPaper({
		modelId: config.modelId,
		topics,
		previewText: previewText ?? "",
		pdfTitleHint: titleHint,
		originalFilename,
	});

	const topicFolder = classification.topicFolder;
	const { path: topicPath, created } = await ensureTopicFolder(config.libraryDir, topicFolder);

	const existingSlugs = await listExistingPaperSlugs(config.obsidianPapersDir);
	const slug = await uniqueSlug(classification.paperSlug, existingSlugs);
	const pdfBasename = await uniqueBasename(topicPath, slug);

	const dstPdfPath = await movePdfToTopic({
		srcPdfPath: pdfPath,
		dstDir: topicPath,
		dstBasename: pdfBasename,
	});

	console.log(`[ingest] filed to: ${dstPdfPath}`);

	const conceptsForPaper = await ensureConceptNotes(config.obsidianConceptsDir, classification.concepts, {
		maxNew: config.maxNewConceptsPerIngest,
	});
	await upsertPaperNote(config.obsidianPapersDir, {
		slug,
		title: classification.title,
		authors: classification.authors,
		year: classification.year,
		topicFolder,
		pdfBasename,
		summary: classification.summary,
		concepts: conceptsForPaper,
	});
	await updatePaperIndex(config.paperIndexFile, slug, topicFolder, pdfBasename);

	if (created || classification.createNewTopic) {
		await reorganizeForNewTopic({ newTopic: topicFolder, config, cache });
	}
}

async function main(): Promise<void> {
	// Load .env from repo root
	dotenv.config({ path: path.join(process.cwd(), ".env") });
	const config = getConfig();

	await ensureDir(config.inboxDir);
	await ensureDir(config.libraryDir);
	await ensureDir(config.obsidianPapersDir);
	await ensureDir(config.obsidianConceptsDir);

	const cache = new PaperCache(process.cwd());
	await cache.load();

	const state = new AgentState(process.cwd());
	await state.load();

	logWatcher("paper-cortex running with:");
	logWatcher(`config inbox: ${config.inboxDir}`);
	logWatcher(`config library: ${config.libraryDir}`);
	logWatcher(`config obsidian vault: ${config.obsidianVaultDir}`);
	logWatcher(`config obsidian concepts: ${config.obsidianConceptsDir}`);
	logWatcher(`config obsidian papers: ${config.obsidianPapersDir}`);
	logWatcher(`config idea log: ${config.ideaLogFile}`);
	logWatcher(`config max new concepts/ingest: ${config.maxNewConceptsPerIngest}`);
	logWatcher(`config model: openai/${config.modelId}`);
	logWatcher(`config cleanup every: ${config.cleanupEveryDays} days`);

	let queue: Promise<void> = Promise.resolve();

	// Periodic cleanup (runs on startup if due, then checks once per day)
	const runCleanup = () => {
		queue = queue
			.then(async () => {
				const res = await runCleanupIfDue({
					config,
					state,
					cleanupEveryDays: config.cleanupEveryDays,
				});
				if (res) {
					console.log(
						`[cleanup] deleted=${res.deletedPaperNotes} notes, updated=${res.updatedFiles} files, removedLinks=${res.removedLinks}`,
					);
				}
			})
			.catch((err) => {
				console.error("[error] cleanup failed:", err);
			});
	};

	runCleanup();
	const cleanupTimer = setInterval(runCleanup, 24 * 60 * 60 * 1000);

	// 1) PDF inbox watcher
	const inboxWatcher = chokidar.watch(config.inboxDir, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: config.stableMs,
			pollInterval: 200,
		},
		ignored: (p) => p.endsWith(".crdownload") || p.endsWith(".download") || p.endsWith(".tmp"),
	});

	inboxWatcher.on("add", (p) => {
		logWatcher(`[watcher:inbox] add: ${p}`);
		if (!p.toLowerCase().endsWith(".pdf")) {
			logWatcher(`[watcher:inbox] ignoring non-pdf: ${p}`);
			return;
		}
		queue = queue
			.then(async () => {
				await ingestPdf({ pdfPath: p, config, cache });
			})
			.catch((err) => {
				console.error(`[error] ingest failed for ${p}:`, err);
			});
	});

	inboxWatcher.on("ready", () => {
		logWatcher(`[watcher:inbox] ready (dir=${config.inboxDir})`);
		// Log a quick snapshot without triggering ingestion (ignoreInitial=true)
		queue = queue
			.then(async () => {
				try {
					const entries = await fs.readdir(config.inboxDir, { withFileTypes: true });
					const pdfCount = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf")).length;
					logWatcher(`[watcher:inbox] snapshot: ${pdfCount} pdf(s) currently in inbox`);
				} catch (err) {
					console.error("[watcher] inbox snapshot error:", err);
				}
			});
	});

	inboxWatcher.on("error", (err) => {
		console.error("[watcher] inbox error:", err);
	});

	// 2) Concepts watcher: fill new concept notes (title-only) with preliminaries.
	const conceptsWatcher = chokidar.watch(config.obsidianConceptsDir, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: config.stableMs,
			pollInterval: 200,
		},
	});

	const conceptHandler = (event: "add" | "change", p: string) => {
		logWatcher(`[watcher:concepts] ${event}: ${p}`);
		if (!p.endsWith(".md")) {
			logWatcher(`[watcher:concepts] ignoring non-md: ${p}`);
			return;
		}
		queue = queue
			.then(async () => {
				await fillConceptPreliminariesIfTitleOnly({
					conceptFilePath: p,
					conceptsDir: config.obsidianConceptsDir,
					papersDir: config.obsidianPapersDir,
					modelId: config.modelId,
				});
			})
			.catch((err) => {
				console.error(`[error] concept fill failed for ${p}:`, err);
			});
	};

	conceptsWatcher.on("ready", () => {
		logWatcher(`[watcher:concepts] ready (dir=${config.obsidianConceptsDir})`);
		queue = queue
			.then(async () => {
				try {
					const entries = await fs.readdir(config.obsidianConceptsDir, { withFileTypes: true });
					const mdCount = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
					logWatcher(`[watcher:concepts] snapshot: ${mdCount} md file(s) in Concepts`);
				} catch (err) {
					console.error("[watcher] concepts snapshot error:", err);
				}
			});
	});
	conceptsWatcher.on("add", (p) => conceptHandler("add", p));
	conceptsWatcher.on("change", (p) => conceptHandler("change", p));
	conceptsWatcher.on("error", (err) => {
		console.error("[watcher] concepts error:", err);
	});

	// 3) Idea log watcher: annotate new top-level bullets with resources.
	const ideaWatcher = chokidar.watch(config.ideaLogFile, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: config.stableMs,
			pollInterval: 200,
		},
	});

	ideaWatcher.on("ready", () => {
		logWatcher(`[watcher:idea-log] ready (file=${config.ideaLogFile})`);
		queue = queue
			.then(async () => {
				try {
					const st = await fs.stat(config.ideaLogFile);
					logWatcher(`[watcher:idea-log] snapshot: size=${st.size} bytes, mtime=${new Date(st.mtimeMs).toISOString()}`);
				} catch (err) {
					console.error("[watcher] idea-log snapshot error:", err);
				}
			});
	});

	ideaWatcher.on("change", (p) => {
		logWatcher(`[watcher:idea-log] change: ${p}`);
		queue = queue
			.then(async () => {
				await annotateIdeaLogFile({
					ideaLogPath: config.ideaLogFile,
					state,
					modelId: config.modelId,
					papersDir: config.obsidianPapersDir,
					conceptsDir: config.obsidianConceptsDir,
				});
			})
			.catch((err) => {
				console.error(`[error] idea log annotation failed:`, err);
			});
	});

	ideaWatcher.on("error", (err) => {
		console.error("[watcher] idea log error:", err);
	});

	const shutdown = async (signal: string) => {
		console.log(`${signal}: shutting down...`);
		clearInterval(cleanupTimer);
		await inboxWatcher.close();
		await conceptsWatcher.close();
		await ideaWatcher.close();
		await queue;
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
