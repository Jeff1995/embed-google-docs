import { App, Modal } from "obsidian";
import { browserUrl, createUrl, DocKind, parseGoogleDocUrl } from "./googleUrl";
import type EmbedGoogleDocsPlugin from "./main";

export const NEW_FILE_NAMES: Record<DocKind, string> = {
	document: "New document",
	spreadsheets: "New spreadsheet",
	presentation: "New presentation",
};

// Opens Google's create page, which makes the file in Google Drive (after
// signing in, if needed) and then goes to its editor; that address is the link.
export class NewDocumentModal extends Modal {
	constructor(
		app: App,
		private plugin: EmbedGoogleDocsPlugin,
		private kind: DocKind,
		private onCreate: (link: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("gdocs-modal");
		this.titleEl.setText(NEW_FILE_NAMES[this.kind]);
		const webview = this.plugin.createWebview(this.contentEl);
		webview.addClass("gdocs-modal-view");
		// The editor may be reached by a redirect or by the page changing its own address.
		for (const name of ["did-navigate", "did-navigate-in-page"]) {
			webview.addEventListener(name, (event) => this.onNavigate((event as Event & { url: string }).url));
		}
		webview.setAttribute("src", createUrl(this.kind));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private onNavigate(url: string): void {
		const doc = parseGoogleDocUrl(url);
		if (!doc) return;
		this.onCreate(browserUrl(doc));
		this.close();
	}
}
