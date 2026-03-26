import { completeSimple, getModels, type Model } from "@mariozechner/pi-ai";

export type OpenAIModel = Model<"openai-responses">;

export function getOpenAIModel(modelId: string): OpenAIModel {
	const model = getModels("openai").find((m) => m.id === modelId);
	if (!model) {
		const available = getModels("openai")
			.slice(0, 20)
			.map((m) => m.id)
			.join(", ");
		throw new Error(`Unknown OpenAI model id: ${modelId}. Available (first 20): ${available}`);
	}
	if (model.api !== "openai-responses") {
		throw new Error(`Model ${modelId} is not openai-responses (got ${model.api})`);
	}
	return model;
}

export function parseJson<T>(text: string): T {
	try {
		return JSON.parse(text) as T;
	} catch {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) throw new Error(`Model did not return JSON. Got: ${text.slice(0, 400)}`);
		return JSON.parse(match[0]) as T;
	}
}

export async function completeText(model: OpenAIModel, prompt: string): Promise<string> {
	const response = await completeSimple(
		model,
		{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
		{ reasoning: "low" },
	);
	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") throw new Error("No text response from model");
	return textBlock.text;
}
