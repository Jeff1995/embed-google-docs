export type EmbedMode = "edit" | "minimal" | "preview";

const EMBED_MODES: EmbedMode[] = ["edit", "minimal", "preview"];

export type DocKind = "document" | "spreadsheets" | "presentation";

export interface GoogleDoc {
	kind: DocKind;
	id: string;
	hash: string;
	// "u/1/" opens the doc as the second signed-in Google account; empty for the first.
	account: string;
	// "Publish to the web" links are read-only pages that embed as they are.
	publishedUrl?: string;
}

export interface EmbedSize {
	width?: number;
	height: number;
}

// What the alias of ![[link|alias]] can set; whatever it leaves out falls back to the settings.
export interface EmbedAlias {
	size?: EmbedSize;
	mode?: EmbedMode;
}

// ![[link]] or ![[link|alias]]
export const EMBED_PATTERN = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

// Published links have "d/e/<id>" in place of "d/<id>".
const DOC_URL =
	/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/(u\/\d+\/)?d\/(e\/)?([\w-]+)[^#\s]*(#\S*)?$/;

const SIZE = /^(?:(\d+)x)?(\d+)$/;

export function parseGoogleDocUrl(link: string): GoogleDoc | null {
	const match = link.trim().match(DOC_URL);
	if (!match) return null;
	return {
		kind: match[1] as DocKind,
		id: match[4],
		hash: match[5] ?? "",
		account: match[2] ?? "",
		publishedUrl: match[3] ? link.trim() : undefined,
	};
}

export function embedUrl(doc: GoogleDoc, mode: EmbedMode): string {
	if (doc.publishedUrl) return doc.publishedUrl;
	const page = { edit: "edit", minimal: "edit?rm=minimal", preview: "preview" }[mode];
	return `https://docs.google.com/${doc.kind}/${doc.account}d/${doc.id}/${page}${doc.hash}`;
}

export function browserUrl(doc: GoogleDoc): string {
	return embedUrl(doc, "edit");
}

// Google's create page makes a new file and redirects to its editor.
export function createUrl(kind: DocKind): string {
	return `https://docs.google.com/${kind}/create`;
}

// Docs export as Markdown, Sheets as CSV of one tab (the link's "#gid=", or else
// the first), Slides as PDF.
export function exportUrl(doc: GoogleDoc): string {
	const format = { document: "md", spreadsheets: "csv", presentation: "pdf" }[doc.kind];
	const gid = doc.hash.match(/gid=(\d+)/)?.[1];
	const tab = gid ? `&gid=${gid}` : "";
	return `https://docs.google.com/${doc.kind}/${doc.account}d/${doc.id}/export?format=${format}${tab}`;
}

// The first signed-in account's recent files of this kind.
export function homeUrl(kind: DocKind): string {
	return `https://docs.google.com/${kind}/u/0/`;
}

// The alias holds a size, a mode or both, as words in any order: "600", "800x600 preview".
// A single number is a height, "800x600" is width x height. Other words are ignored.
export function parseAlias(alias: string | null | undefined): EmbedAlias {
	const result: EmbedAlias = {};
	for (const word of alias?.trim().split(/\s+/) ?? []) {
		const size = word.match(SIZE);
		if (size) result.size = { width: size[1] ? Number(size[1]) : undefined, height: Number(size[2]) };
		if (EMBED_MODES.includes(word as EmbedMode)) result.mode = word as EmbedMode;
	}
	return result;
}

export function embedSource(link: string, { size, mode }: EmbedAlias): string {
	const sizeText = size && (size.width ? `${size.width}x${size.height}` : `${size.height}`);
	const alias = [sizeText, mode].filter(Boolean).join(" ");
	return alias ? `![[${link}|${alias}]]` : `![[${link}]]`;
}

// Keeps the mode written in the alias; only the size changes.
export function replaceEmbedSize(text: string, docId: string, size: EmbedSize): string {
	return text.replace(EMBED_PATTERN, (embed, link: string, alias?: string) =>
		parseGoogleDocUrl(link)?.id === docId ? embedSource(link, { ...parseAlias(alias), size }) : embed,
	);
}

export function replaceEmbedWith(text: string, docId: string, replacement: string): string {
	return text.replace(EMBED_PATTERN, (embed, link: string) =>
		parseGoogleDocUrl(link)?.id === docId ? replacement : embed,
	);
}
