import { App, Modal } from "obsidian";
import { KIND_LABELS, WebviewElement } from "./embed";
import { browserUrl, createUrl, DocKind, homeUrl, parseGoogleDocUrl } from "./googleUrl";
import type EmbedGoogleDocsPlugin from "./main";

export const NEW_FILE_NAMES: Record<DocKind, string> = {
	document: "New document",
	spreadsheets: "New spreadsheet",
	presentation: "New presentation",
};

// A Google page that ends up in a document's editor; that address is the link.
class DocumentModal extends Modal {
	protected webview!: WebviewElement;

	constructor(
		app: App,
		private plugin: EmbedGoogleDocsPlugin,
		private title: string,
		private url: string,
		private onDocument: (link: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("gdocs-modal");
		this.titleEl.setText(this.title);
		this.webview = this.plugin.createWebview(this.contentEl);
		this.webview.addClass("gdocs-modal-view");
		// The editor may be reached by a redirect or by the page changing its own address.
		for (const name of ["did-navigate", "did-navigate-in-page"]) {
			this.webview.addEventListener(name, (event) => this.onNavigate((event as Event & { url: string }).url));
		}
		this.webview.setAttribute("src", this.url);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private onNavigate(url: string): void {
		const doc = parseGoogleDocUrl(url);
		if (!doc) return;
		this.onDocument(browserUrl(doc));
		this.close();
	}
}

// Google's create page makes a new file in Google Drive (after signing in, if
// needed) and then goes to its editor.
export class NewDocumentModal extends DocumentModal {
	constructor(app: App, plugin: EmbedGoogleDocsPlugin, kind: DocKind, onCreate: (link: string) => void) {
		super(app, plugin, NEW_FILE_NAMES[kind], createUrl(kind), onCreate);
	}
}

// Google's home pages for Docs, Sheets and Slides list the user's files and open
// them in the same page. Drive itself would open them in a new window, which
// Obsidian sends to the browser.
export class DriveModal extends DocumentModal {
	constructor(app: App, plugin: EmbedGoogleDocsPlugin, onPick: (link: string) => void) {
		super(app, plugin, "Insert from Google Drive", homeUrl("document"), onPick);
	}

	onOpen(): void {
		const kinds = this.contentEl.createDiv({ cls: "gdocs-modal-kinds" });
		super.onOpen();
		for (const kind of Object.keys(KIND_LABELS) as DocKind[]) {
			const button = kinds.createEl("button", { text: KIND_LABELS[kind] });
			button.toggleClass("mod-cta", kind === "document");
			button.addEventListener("click", () => {
				kinds.findAll("button").forEach((other) => other.toggleClass("mod-cta", other === button));
				this.webview.setAttribute("src", homeUrl(kind));
			});
		}
	}
}
