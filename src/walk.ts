import fs from "node:fs/promises";
import path from "node:path";

export async function* walkFiles(rootDir: string): AsyncGenerator<string> {
	const entries = await fs.readdir(rootDir, { withFileTypes: true });
	for (const e of entries) {
		const p = path.join(rootDir, e.name);
		if (e.isDirectory()) {
			yield* walkFiles(p);
		} else if (e.isFile()) {
			yield p;
		}
	}
}
