import fs from "node:fs/promises";

export async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

export async function ensureDir(p: string): Promise<void> {
	await fs.mkdir(p, { recursive: true });
}

export async function readUtf8(p: string): Promise<string> {
	return await fs.readFile(p, "utf-8");
}

export async function writeUtf8(p: string, content: string): Promise<void> {
	await fs.writeFile(p, content, "utf-8");
}

export async function atomicWriteUtf8(p: string, content: string): Promise<void> {
	const tmp = `${p}.tmp`;
	await fs.writeFile(tmp, content, "utf-8");
	await fs.rename(tmp, p);
}
