import { spawn } from "node:child_process";

export interface PdfInfo {
	title?: string;
	pages?: number;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? -1 });
		});
	});
}

export async function pdfInfo(pdfPath: string): Promise<PdfInfo> {
	const res = await run("pdfinfo", [pdfPath], 10_000);
	if (res.code !== 0) return {};

	const lines = res.stdout.split(/\r?\n/);
	const out: PdfInfo = {};
	for (const line of lines) {
		const mTitle = /^Title:\s+(.*)$/.exec(line);
		if (mTitle) out.title = mTitle[1]?.trim();
		const mPages = /^Pages:\s+(\d+)$/.exec(line);
		if (mPages) out.pages = Number(mPages[1]);
	}
	return out;
}

export async function pdfToTextPreview(pdfPath: string, pages: number): Promise<string> {
	// Writes to stdout when output file is "-"
	const args = ["-f", "1", "-l", String(Math.max(1, pages)), "-layout", pdfPath, "-"];
	const res = await run("pdftotext", args, 30_000);
	if (res.code !== 0) {
		throw new Error(`pdftotext failed (${res.code}): ${res.stderr.trim()}`);
	}
	return res.stdout;
}
