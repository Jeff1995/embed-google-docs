export type EmbedMode = "edit" | "minimal" | "preview";

export interface GoogleDoc {
	kind: "document" | "spreadsheets" | "presentation";
	id: string;
	hash: string;
}

export interface EmbedSize {
	width?: number;
	height: number;
}

// ![[link]] or ![[link|alias]]
export const EMBED_PATTERN = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

const DOC_URL =
	/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]+)[^#]*(#.*)?$/;

const SIZE = /^(?:(\d+)x)?(\d+)$/;

export function parseGoogleDocUrl(link: string): GoogleDoc | null {
	const match = link.trim().match(DOC_URL);
	if (!match) return null;
	return { kind: match[1] as GoogleDoc["kind"], id: match[2], hash: match[3] ?? "" };
}

export function embedUrl(doc: GoogleDoc, mode: EmbedMode): string {
	const page = { edit: "edit", minimal: "edit?rm=minimal", preview: "preview" }[mode];
	return `https://docs.google.com/${doc.kind}/d/${doc.id}/${page}${doc.hash}`;
}

export function browserUrl(doc: GoogleDoc): string {
	return embedUrl(doc, "edit");
}

// The alias holds the size: "600" is a height, "800x600" is width x height.
export function parseSize(alias: string | null | undefined): EmbedSize | null {
	const match = alias?.trim().match(SIZE);
	if (!match) return null;
	return { width: match[1] ? Number(match[1]) : undefined, height: Number(match[2]) };
}

export function embedSource(link: string, size: EmbedSize): string {
	const alias = size.width ? `${size.width}x${size.height}` : `${size.height}`;
	return `![[${link}|${alias}]]`;
}

export function replaceEmbedSize(text: string, docId: string, size: EmbedSize): string {
	return text.replace(EMBED_PATTERN, (embed, link: string) =>
		parseGoogleDocUrl(link)?.id === docId ? embedSource(link, size) : embed,
	);
}
