import path from "node:path";

export function slugifyPaper(input: string): string {
	const cleaned = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
	return cleaned.length > 0 ? cleaned : "untitled";
}

export function topicify(input: string): string {
	// Title_Case_Underscore, keeps alphanumerics.
	const parts = input
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(/\s+/g)
		.filter(Boolean);
	if (parts.length === 0) return "Unsorted";
	return parts
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("_")
		.replace(/_+/g, "_");
}

export function ensurePdfBasename(filePath: string): string {
	const base = path.basename(filePath);
	return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export function withoutPdfExt(name: string): string {
	return name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
}

export function isValidTopicName(topic: string): boolean {
	return /^[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)*$/.test(topic);
}

export function isValidPaperSlug(slug: string): boolean {
	return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(slug);
}
