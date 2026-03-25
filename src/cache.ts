import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ensureDir, exists, readUtf8, atomicWriteUtf8 } from "./fs-utils.js";

export interface PaperCacheEntry {
	sha256: string;
	pdfPath: string;
	mtimeMs: number;
	size: number;
	previewText: string;
	pdfTitle?: string;
}

export interface CacheFile {
	version: 1;
	entries: Record<string, PaperCacheEntry>; // keyed by sha256
}

export class PaperCache {
	private readonly cachePath: string;
	private data: CacheFile;

	constructor(baseDir: string) {
		this.cachePath = path.join(baseDir, "data", "cache.json");
		this.data = { version: 1, entries: {} };
	}

	async load(): Promise<void> {
		await ensureDir(path.dirname(this.cachePath));
		if (!(await exists(this.cachePath))) return;
		const raw = await readUtf8(this.cachePath);
		const parsed = JSON.parse(raw) as CacheFile;
		if (parsed.version !== 1) return;
		this.data = parsed;
	}

	async save(): Promise<void> {
		await atomicWriteUtf8(this.cachePath, `${JSON.stringify(this.data, null, 2)}\n`);
	}

	get(sha256: string): PaperCacheEntry | undefined {
		return this.data.entries[sha256];
	}

	set(entry: PaperCacheEntry): void {
		this.data.entries[entry.sha256] = entry;
	}

	static async sha256File(filePath: string): Promise<{ sha256: string; size: number; mtimeMs: number }> {
		// On macOS file-provider backed folders (Google Drive/iCloud/etc.), newly created files can
		// briefly exist but be unreadable, yielding errno=-11 (EAGAIN) via Node as
		// "Unknown system error -11". We retry to allow the provider to finish materializing the file.
		const isRetryable = (err: unknown): boolean => {
			if (!err || typeof err !== "object") return false;
			const e = err as { errno?: number; code?: string };
			return (
				e.errno === -11 ||
				e.code === "EAGAIN" ||
				e.code === "EBUSY" ||
				e.code === "Unknown system error -11"
			);
		};

		const sleep = async (ms: number) => {
			await new Promise((r) => setTimeout(r, ms));
		};

		const maxAttempts = 10;
		let delayMs = 250;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const stat = await fs.stat(filePath);
				const buf = await fs.readFile(filePath);
				const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
				return { sha256, size: stat.size, mtimeMs: stat.mtimeMs };
			} catch (err) {
				if (attempt < maxAttempts && isRetryable(err)) {
					await sleep(delayMs);
					delayMs = Math.min(delayMs * 2, 5000);
					continue;
				}
				throw err;
			}
		}

		// Unreachable, but keeps TS happy.
		throw new Error(`sha256File: exhausted retries for ${filePath}`);
	}
}
