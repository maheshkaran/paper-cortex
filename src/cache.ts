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
		const stat = await fs.stat(filePath);
		const buf = await fs.readFile(filePath);
		const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
		return { sha256, size: stat.size, mtimeMs: stat.mtimeMs };
	}
}
