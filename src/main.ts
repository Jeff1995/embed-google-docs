import { Prec } from "@codemirror/state";
import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting } from "obsidian";
import { GoogleAccountModal, SIGN_IN_URL, SIGN_OUT_URL } from "./account";
import { createEmbed, registerWebviewHost, WebviewElement } from "./embed";
import { EmbedMode, EmbedSize, GoogleDoc, parseGoogleDocUrl, replaceEmbedSize } from "./googleUrl";
import { livePreviewEmbeds } from "./livePreview";

// Obsidian rewrites Google sign-in headers on the sessions it creates for its
// web viewer, which makes Google reject the login. A partition of our own is
// left alone. It must not start with "vault-": Obsidian deletes those on launch.
const PARTITION = "persist:embed-google-docs";

interface Settings {
	mode: EmbedMode;
	defaultHeight: number;
	userAgent: string;
}

const DEFAULT_SETTINGS: Settings = {
	mode: "edit",
	defaultHeight: 600,
	userAgent: "",
};

export default class EmbedGoogleDocsPlugin extends Plugin {
	settings!: Settings;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		registerWebviewHost();

		this.registerMarkdownPostProcessor((el, ctx) => this.renderReadingViewEmbeds(el, ctx));
		// Take precedence over Obsidian's own rendering of ![[...]], which would show "not found".
		this.registerEditorExtension(Prec.highest(livePreviewEmbeds(this)));

		this.addCommand({
			id: "sign-in",
			name: "Sign in to Google",
			callback: () => this.openAccountModal(SIGN_IN_URL),
		});
		this.addCommand({
			id: "sign-out",
			name: "Sign out of Google",
			callback: () => this.openAccountModal(SIGN_OUT_URL),
		});
		this.addSettingTab(new EmbedGoogleDocsSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	defaultSize(): EmbedSize {
		return { height: this.settings.defaultHeight };
	}

	// `doc` must be the document of the window the webview goes into: Obsidian
	// crashes when a webview made by one window is inserted into another (pop-out
	// windows, the settings window). Set "src" after this; the partition has to be
	// in place before the first navigation.
	createWebview(doc: Document): WebviewElement {
		const webview = doc.createElement("webview") as WebviewElement;
		webview.setAttribute("partition", PARTITION);
		webview.setAttribute("useragent", this.settings.userAgent || chromeUserAgent());
		// Obsidian denies pop-ups from webviews and opens their links in the browser instead;
		// without this attribute, links inside a document would do nothing.
		webview.setAttribute("allowpopups", "");
		webview.addEventListener("dom-ready", () => webview.addClass("is-ready"));
		retryFailedLoadOnce(webview);
		return webview;
	}

	reloadEmbeds(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaf.view.containerEl
				.querySelectorAll<WebviewElement>("webview.gdocs-embed-view.is-ready")
				.forEach((webview) => webview.reload());
		});
	}

	openAccountModal(url: string): void {
		new GoogleAccountModal(this.app, this, url).open();
	}

	private renderReadingViewEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		for (const placeholder of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed[src]"))) {
			const doc = parseGoogleDocUrl(placeholder.getAttribute("src")!);
			if (!doc) continue;
			const size = placeholderSize(placeholder) ?? this.defaultSize();
			// Swapping the element out keeps Obsidian from filling it with "not found".
			placeholder.replaceWith(
				createEmbed(this, doc, size, { onResize: (newSize) => this.saveSizeInFile(el, ctx, doc, newSize) }),
			);
		}
	}

	private async saveSizeInFile(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		doc: GoogleDoc,
		size: EmbedSize,
	): Promise<void> {
		const section = ctx.getSectionInfo(el);
		const file = this.app.vault.getFileByPath(ctx.sourcePath);
		// Embeds shown inside another note (transclusions, hover previews) have no section to write to.
		if (!section || !file) return;
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			for (let i = section.lineStart; i <= section.lineEnd; i++) {
				lines[i] = replaceEmbedSize(lines[i], doc.id, size);
			}
			return lines.join("\n");
		});
	}
}

// Every so often a webview's first load fails with ERR_SOCKET_NOT_CONNECTED and
// leaves a blank page, while loading again works.
function retryFailedLoadOnce(webview: WebviewElement): void {
	let retried = false;
	webview.addEventListener("did-fail-load", (event) => {
		const { errorCode, isMainFrame } = event as Event & { errorCode: number; isMainFrame: boolean };
		// -3 (ERR_ABORTED) only means another navigation took over.
		if (retried || !isMainFrame || errorCode === -3) return;
		retried = true;
		window.setTimeout(() => webview.isConnected && webview.reload(), 1000);
	});
}

// Obsidian parses a size alias the way it does for images: "800x600" becomes
// width and height attributes, a lone "600" becomes width. For us that is the height.
function placeholderSize(placeholder: HTMLElement): EmbedSize | null {
	const width = placeholder.getAttribute("width");
	const height = placeholder.getAttribute("height");
	if (!width) return null;
	return height ? { width: Number(width), height: Number(height) } : { height: Number(width) };
}

// Obsidian's user agent minus its "obsidian/x" and "Electron/x" tokens: what Chrome sends.
function chromeUserAgent(): string {
	return navigator.userAgent
		.split(" ")
		.filter((token) => !/^(obsidian|electron)\//i.test(token))
		.join(" ");
}

class EmbedGoogleDocsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: EmbedGoogleDocsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Google account")
			.setDesc("Sign in once; every embed uses this session. Open embeds reload when the window closes.")
			.addButton((button) =>
				button
					.setButtonText("Sign in")
					.setCta()
					.onClick(() => this.plugin.openAccountModal(SIGN_IN_URL)),
			)
			.addButton((button) =>
				button.setButtonText("Sign out").onClick(() => this.plugin.openAccountModal(SIGN_OUT_URL)),
			);

		new Setting(containerEl)
			.setName("Embed mode")
			.setDesc("How documents open. Applies to embeds rendered after the change.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						edit: "Editor",
						minimal: "Editor without menus",
						preview: "Read-only preview",
					})
					.setValue(settings.mode)
					.onChange(async (value) => {
						settings.mode = value as EmbedMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default height")
			.setDesc("Height in pixels for links without a size, such as ![[link]] rather than ![[link|600]].")
			.addSlider((slider) =>
				slider
					.setLimits(200, 1600, 50)
					.setValue(settings.defaultHeight)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.defaultHeight = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("User agent")
			.setDesc("Leave empty to send Chrome's user agent. Change it only if Google refuses the sign-in.")
			.addText((text) =>
				text
					.setPlaceholder(chromeUserAgent())
					.setValue(settings.userAgent)
					.onChange(async (value) => {
						settings.userAgent = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
