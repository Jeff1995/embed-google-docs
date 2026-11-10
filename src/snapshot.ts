import { App, base64ToArrayBuffer, TFile } from "obsidian";
import type { WebviewElement } from "./embed";
import { exportUrl, GoogleDoc, parseGoogleDocUrl } from "./googleUrl";

// Google's Markdown export puts each picture at the end, as
// "[image1]: <data:image/png;base64,...>", and shows it with "![][image1]".
const IMAGE_DEFINITION = /^\[([^\]]+)\]:\s*<data:image\/([\w.+-]+);base64,([^>]+)>\s*$/gm;
const IMAGE_REFERENCE = /!\[[^\]]*\]\[([^\]]+)\]/g;

// The document as Markdown, to put in place of its embed: Docs as their text,
// Sheets as a table of the tab on screen, Slides as a PDF. Files go where the
// vault keeps attachments for the note.
export async function snapshotMarkdown(
	app: App,
	webview: WebviewElement,
	embedded: GoogleDoc,
	sourcePath: string,
): Promise<string> {
	// The page may have moved on since, as to another tab of a spreadsheet.
	const doc = parseGoogleDocUrl(webview.getURL()) ?? embedded;
	const data = await download(webview, exportUrl(doc));
	const title = documentTitle(webview);
	if (doc.kind === "presentation") {
		return embedLink(app, await saveAttachment(app, `${title}.pdf`, data, sourcePath), sourcePath);
	}
	const text = new TextDecoder().decode(data);
	if (doc.kind === "spreadsheets") return markdownTable(parseCsv(text));
	return saveImages(app, text, title, sourcePath);
}

// Fetched by the page itself, so with its Google sign-in. Google answers a request
// it refuses with a sign-in or error page.
async function download(webview: WebviewElement, url: string): Promise<ArrayBuffer> {
	const [ok, data] = (await webview.executeJavaScript(
		`fetch(${JSON.stringify(url)}).then(async (response) => [
			response.ok && !response.headers.get("content-type").startsWith("text/html"),
			new Uint8Array(await response.arrayBuffer()),
		])`,
	)) as [boolean, Uint8Array];
	if (!ok) throw new Error("Google did not hand over the document. Sign in with an account that can open it.");
	return data.slice().buffer;
}

// Writes the pictures out as attachments and links to those instead.
async function saveImages(app: App, markdown: string, title: string, sourcePath: string): Promise<string> {
	const links = new Map<string, string>();
	for (const [, name, type, base64] of markdown.matchAll(IMAGE_DEFINITION)) {
		const extension = type === "svg+xml" ? "svg" : type;
		const file = await saveAttachment(app, `${title} ${name}.${extension}`, base64ToArrayBuffer(base64), sourcePath);
		links.set(name, embedLink(app, file, sourcePath));
	}
	return markdown
		.replace(IMAGE_DEFINITION, "")
		.replace(IMAGE_REFERENCE, (reference, name: string) => links.get(name) ?? reference)
		.trim();
}

async function saveAttachment(app: App, name: string, data: ArrayBuffer, sourcePath: string): Promise<TFile> {
	return app.vault.createBinary(await app.fileManager.getAvailablePathForAttachment(name, sourcePath), data);
}

// In the vault's own link format, wiki or Markdown.
function embedLink(app: App, file: TFile, sourcePath: string): string {
	return "!" + app.fileManager.generateMarkdownLink(file, sourcePath);
}

// "Q3 plan - Google Docs" becomes "Q3 plan", without characters file names cannot hold.
function documentTitle(webview: WebviewElement): string {
	const title = webview
		.getTitle()
		.replace(/ - Google (Docs|Sheets|Slides)$/, "")
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.trim();
	return title || "Untitled";
}

// Cells may be quoted, and quoted cells may hold commas, line breaks and doubled quotes.
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') quoted = false;
			else cell += char;
		} else if (char === '"') quoted = true;
		else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else if (char !== "\r") cell += char;
	}
	row.push(cell);
	rows.push(row);
	return rows;
}

// The first row is the header.
function markdownTable(rows: string[][]): string {
	const line = (cells: string[]) =>
		`| ${cells.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`;
	const [header, ...body] = rows;
	return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
}
