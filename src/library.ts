import path from "node:path";
import fs from "node:fs/promises";
import { ensureDir, exists } from "./fs-utils.js";

export interface TopicFolder {
	name: string; // folder name
	path: string;
}

export interface LibraryPaper {
	topic: string;
	pdfPath: string;
	pdfBasename: string;
	slug: string;
}

export async function listTopicFolders(libraryDir: string): Promise<TopicFolder[]> {
	await ensureDir(libraryDir);
	const entries = await fs.readdir(libraryDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => ({ name: e.name, path: path.join(libraryDir, e.name) }))
		.filter((t) => !t.name.startsWith("."));
}

export async function listAllPapers(libraryDir: string): Promise<LibraryPaper[]> {
	const topics = await listTopicFolders(libraryDir);
	const out: LibraryPaper[] = [];
	for (const topic of topics) {
		const files = await fs.readdir(topic.path, { withFileTypes: true });
		for (const f of files) {
			if (!f.isFile()) continue;
			if (!f.name.toLowerCase().endsWith(".pdf")) continue;
			const slug = f.name.slice(0, -4);
			out.push({
				topic: topic.name,
				pdfPath: path.join(topic.path, f.name),
				pdfBasename: f.name,
				slug,
			});
		}
	}
	return out;
}

export async function findPdfByHash(libraryDir: string, sha256: string): Promise<string | null> {
	// Placeholder for future: could maintain a hash index. For now, no-op.
	void libraryDir;
	void sha256;
	return null;
}

export async function ensureTopicFolder(libraryDir: string, topicName: string): Promise<{ path: string; created: boolean }> {
	const p = path.join(libraryDir, topicName);
	if (await exists(p)) return { path: p, created: false };
	await fs.mkdir(p, { recursive: true });
	return { path: p, created: true };
}

export async function movePdfToTopic(args: {
	srcPdfPath: string;
	dstDir: string;
	dstBasename: string;
}): Promise<string> {
	await ensureDir(args.dstDir);
	const dstPath = path.join(args.dstDir, args.dstBasename);
	await fs.rename(args.srcPdfPath, dstPath);
	return dstPath;
}
