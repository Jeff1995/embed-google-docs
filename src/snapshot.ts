import { App, moment, normalizePath, TFile } from "obsidian";
import type { WebviewElement } from "./embed";
import { browserUrl, exportUrl, GoogleDoc, parseGoogleDocUrl } from "./googleUrl";

// The property that marks a note as the snapshot of a document, holding its link.
const SNAPSHOT_OF = "snapshot-of";

// A copy of the document as a note, for search, offline reading and other devices.
// Slides are a PDF next to the note. Saving the same document again updates its copy.
export async function writeSnapshot(app: App, webview: WebviewElement, embedded: GoogleDoc): Promise<TFile> {
	// The page may have moved on since, as to another tab of a spreadsheet.
	const doc = parseGoogleDocUrl(webview.getURL()) ?? embedded;
	const data = await download(webview, exportUrl(doc));
	const existing = findSnapshot(app, doc);
	const base = existing ? existing.path.slice(0, -".md".length) : freeBasePath(app, documentTitle(webview));

	let body: string;
	if (doc.kind === "presentation") {
		await writeBinary(app, `${base}.pdf`, data);
		body = `![[${base}.pdf]]`;
	} else {
		const text = new TextDecoder().decode(data);
		body = doc.kind === "spreadsheets" ? markdownTable(parseCsv(text)) : text;
	}

	const note = `---\n${SNAPSHOT_OF}: ${browserUrl(doc)}\nsaved: ${moment().format("YYYY-MM-DDTHH:mm")}\n---\n\n${body}\n`;
	if (existing) {
		await app.vault.modify(existing, note);
		return existing;
	}
	return app.vault.create(`${base}.md`, note);
}

// Fetched by the page itself, so with its Google sign-in. Google answers a request
// it refuses with a sign-in or error page.
async function download(webview: WebviewElement, url: string): Promise<Uint8Array> {
	const [ok, data] = (await webview.executeJavaScript(
		`fetch(${JSON.stringify(url)}).then(async (response) => [
			response.ok && !response.headers.get("content-type").startsWith("text/html"),
			new Uint8Array(await response.arrayBuffer()),
		])`,
	)) as [boolean, Uint8Array];
	if (!ok) throw new Error("Google did not hand over the document. Sign in with an account that can open it.");
	return data;
}

function findSnapshot(app: App, doc: GoogleDoc): TFile | undefined {
	return app.vault.getMarkdownFiles().find((file) => {
		const link: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[SNAPSHOT_OF];
		return typeof link === "string" && parseGoogleDocUrl(link)?.id === doc.id;
	});
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

// Where Obsidian puts new notes, under a name free for both the note and a PDF.
function freeBasePath(app: App, title: string): string {
	const folder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "").path;
	for (let n = 0; ; n++) {
		const base = normalizePath(`${folder}/${n ? `${title} ${n}` : title}`);
		if (!app.vault.getAbstractFileByPath(`${base}.md`) && !app.vault.getAbstractFileByPath(`${base}.pdf`)) {
			return base;
		}
	}
}

async function writeBinary(app: App, path: string, data: Uint8Array): Promise<void> {
	const file = app.vault.getFileByPath(path);
	const buffer = data.slice().buffer;
	if (file) await app.vault.modifyBinary(file, buffer);
	else await app.vault.createBinary(path, buffer);
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
