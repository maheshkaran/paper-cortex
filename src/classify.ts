import { completeSimple } from "@mariozechner/pi-ai";
import { getOpenAIModel, parseJson } from "./llm.js";
import { isValidPaperSlug, isValidTopicName, slugifyPaper, topicify } from "./slug.js";

export interface ClassificationResult {
	topicFolder: string;
	createNewTopic: boolean;
	paperSlug: string;
	title: string;
	authors?: string;
	year?: string;
	summary: string;
	concepts: string[];
	confidence: number; // 0..1
}

type LlmClassificationJson = {
	topic: string;
	createNewTopic: boolean;
	slug: string;
	title: string;
	authors?: string;
	year?: string;
	summary: string;
	concepts: string[];
	confidence: number;
};

export async function classifyPaper(params: {
	modelId: string;
	topics: string[];
	previewText: string;
	pdfTitleHint?: string;
	originalFilename: string;
}): Promise<ClassificationResult> {
	const model = getOpenAIModel(params.modelId);
	const topicsList = params.topics.length > 0 ? params.topics.join(", ") : "(none)";

	const prompt = `You are classifying a new academic paper PDF into an existing topic folder, or creating a new one.

Existing topic folders (must match exactly if choosing an existing one):
${topicsList}

Naming rules:
- topic folder: Title_Case_Underscore
- paper slug: lowercase_underscore (must be short, stable)
- concepts: Title_Case_Underscore

PDF title hint (may be empty/garbage): ${params.pdfTitleHint ?? "(none)"}
Original filename: ${params.originalFilename}

Paper text preview (first pages):
---
${params.previewText.slice(0, 14_000)}
---

Return ONLY a JSON object with keys:
- topic (string)
- createNewTopic (boolean)
- slug (string)
- title (string)
- authors (optional string)
- year (optional string)
- summary (string, markdown, short)
- concepts (string array)
- confidence (number 0..1)`;

	const response = await completeSimple(
		model,
		{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
		{ reasoning: "minimal" },
	);
	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") throw new Error("No text response from model");

	const parsed = parseJson<LlmClassificationJson>(textBlock.text);

	const topic = isValidTopicName(parsed.topic) ? parsed.topic : topicify(parsed.topic);
	const slug = isValidPaperSlug(parsed.slug) ? parsed.slug : slugifyPaper(parsed.slug);

	return {
		topicFolder: topic,
		createNewTopic: Boolean(parsed.createNewTopic),
		paperSlug: slug,
		title: parsed.title?.trim() || slug,
		authors: parsed.authors?.trim(),
		year: parsed.year?.trim(),
		summary: parsed.summary?.trim() || "(summary missing)",
		concepts: (parsed.concepts ?? []).map((c) => c.trim()).filter((c) => c.length > 0),
		confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
	};
}

export async function shouldMoveToNewTopic(params: {
	modelId: string;
	newTopic: string;
	previewText: string;
	currentTopic: string;
	slug: string;
}): Promise<{ move: boolean; confidence: number; reason: string }> {
	const model = getOpenAIModel(params.modelId);

	const prompt = `We created a NEW topic folder: ${params.newTopic}

Decide if this existing paper belongs in the new topic instead of its current topic.
Current topic: ${params.currentTopic}
Paper slug: ${params.slug}

Text preview:
---
${params.previewText.slice(0, 10_000)}
---

Return ONLY JSON: {"move": boolean, "confidence": number, "reason": string}`;

	const response = await completeSimple(
		model,
		{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
		{ reasoning: "minimal" },
	);
	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") throw new Error("No text response from model");

	const parsed = parseJson<{ move: boolean; confidence: number; reason: string }>(textBlock.text);
	return {
		move: Boolean(parsed.move),
		confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
		reason: parsed.reason || "",
	};
}
