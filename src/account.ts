import { App, Modal } from "obsidian";
import type EmbedGoogleDocsPlugin from "./main";

export const SIGN_IN_URL =
	"https://accounts.google.com/ServiceLogin?continue=" +
	encodeURIComponent("https://docs.google.com/document/u/0/");
export const SIGN_OUT_URL = "https://accounts.google.com/Logout";

// Signing in happens inside a webview on the embeds' own session, so the
// Google cookies it leaves behind are the ones every embed uses.
export class GoogleAccountModal extends Modal {
	constructor(
		app: App,
		private plugin: EmbedGoogleDocsPlugin,
		private url: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("gdocs-account-modal");
		this.titleEl.setText("Google account");
		const webview = this.plugin.createWebview(this.contentEl.doc);
		webview.addClass("gdocs-account-view");
		webview.setAttribute("src", this.url);
		this.contentEl.appendChild(webview);
	}

	onClose(): void {
		this.contentEl.empty();
		this.plugin.reloadEmbeds();
	}
}
