import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteUtf8, ensureDir, exists, readUtf8 } from "./fs-utils.js";

export interface AgentStateFile {
	version: 1;
	processedIdeaHashes: Record<string, { idea: string; timestamp: number }>;
	lastCleanupTimestamp?: number;
}

export class AgentState {
	private readonly statePath: string;
	private data: AgentStateFile;

	constructor(baseDir: string) {
		this.statePath = path.join(baseDir, "data", "state.json");
		this.data = { version: 1, processedIdeaHashes: {} };
	}

	async load(): Promise<void> {
		await ensureDir(path.dirname(this.statePath));
		if (!(await exists(this.statePath))) return;
		const raw = await readUtf8(this.statePath);
		const parsed = JSON.parse(raw) as AgentStateFile;
		if (parsed.version !== 1) return;
		this.data = parsed;
		if (!this.data.processedIdeaHashes) this.data.processedIdeaHashes = {};
	}

	async save(): Promise<void> {
		await atomicWriteUtf8(this.statePath, `${JSON.stringify(this.data, null, 2)}\n`);
	}

	hasProcessedIdea(idea: string): boolean {
		const h = AgentState.hashIdea(idea);
		return this.data.processedIdeaHashes[h] !== undefined;
	}

	markIdeaProcessed(idea: string): void {
		const h = AgentState.hashIdea(idea);
		this.data.processedIdeaHashes[h] = { idea, timestamp: Date.now() };
	}

	getLastCleanupTimestamp(): number | null {
		return typeof this.data.lastCleanupTimestamp === "number" ? this.data.lastCleanupTimestamp : null;
	}

	setLastCleanupTimestamp(ts: number): void {
		this.data.lastCleanupTimestamp = ts;
	}

	static hashIdea(idea: string): string {
		return crypto.createHash("sha256").update(idea.trim()).digest("hex");
	}
}
