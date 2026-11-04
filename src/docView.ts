import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createDocumentHost, WebviewElement } from "./embed";
import { browserUrl, parseGoogleDocUrl } from "./googleUrl";
import type EmbedGoogleDocsPlugin from "./main";

export const DOC_VIEW_TYPE = "embed-google-docs";

type DocViewState = {
	url: string;
	title: string;
};

// A document in a tab of its own, for more room than an embed has.
export class GoogleDocView extends ItemView {
	private state: DocViewState = { url: "", title: "Google Docs" };

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EmbedGoogleDocsPlugin,
	) {
		super(leaf);
		this.addAction("external-link", "Open in browser", () =>
			window.open(browserUrl(parseGoogleDocUrl(this.state.url)!)),
		);
		this.addAction("rotate-cw", "Reload", () => this.contentEl.querySelector<WebviewElement>("webview")?.reload());
	}

	getViewType(): string {
		return DOC_VIEW_TYPE;
	}

	getIcon(): string {
		return "file-text";
	}

	// Obsidian has no public way to refresh a tab's title, so the tab starts with
	// the title the embed showed; later titles are saved for the next restart.
	getDisplayText(): string {
		return this.state.title;
	}

	getState(): Record<string, unknown> {
		return this.state;
	}

	async setState(state: DocViewState, result: ViewStateResult): Promise<void> {
		this.state = state;
		// Obsidian fills in the title above the content once, when the view opens, before it has a state.
		this.containerEl.find(".view-header-title").setText(state.title);
		this.contentEl.replaceChildren(createDocumentHost(this.plugin, state.url, (title) => (this.state.title = title)));
		await super.setState(state, result);
	}
}
