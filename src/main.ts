import { Prec } from "@codemirror/state";
import {
	App,
	Editor,
	Keymap,
	MarkdownPostProcessorContext,
	MarkdownView,
	Modal,
	Platform,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
} from "obsidian";
import { GoogleAccountModal, SIGN_IN_URL, SIGN_OUT_URL } from "./account";
import { DOC_VIEW_TYPE, GoogleDocView } from "./docView";
import { DriveModal, NEW_FILE_NAMES, NewDocumentModal } from "./documentModals";
import { createEmbed, EmbedOptions, registerWebviewHost, WebviewElement } from "./embed";
import {
	DocKind,
	EmbedAlias,
	EmbedMode,
	EmbedSize,
	embedSource,
	GoogleDoc,
	parseAlias,
	parseGoogleDocUrl,
	replaceEmbedSize,
} from "./googleUrl";
import { livePreviewEmbeds } from "./livePreview";

// Obsidian rewrites Google sign-in headers on the sessions it creates for its
// web viewer, which makes Google reject the login. A partition of our own is
// left alone. It must not start with "vault-": Obsidian deletes those on launch.
const PARTITION = "persist:embed-google-docs";

// Google's editors have no dark theme; inverting the page comes close. Pictures
// in the page are turned back, but the documents themselves are drawn on a
// canvas, so pictures inside them stay inverted.
const DARK_CSS = "html { filter: invert(0.88) hue-rotate(180deg); } img, video { filter: invert(1) hue-rotate(180deg); }";

interface Settings {
	mode: EmbedMode;
	defaultHeight: number;
	embedPastedLinks: boolean;
	darkDocuments: boolean;
	userAgent: string;
}

const DEFAULT_SETTINGS: Settings = {
	mode: "edit",
	defaultHeight: 600,
	embedPastedLinks: true,
	darkDocuments: true,
	userAgent: "",
};

export default class EmbedGoogleDocsPlugin extends Plugin {
	settings!: Settings;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<Settings> | null);
		registerWebviewHost();

		this.registerMarkdownPostProcessor((el, ctx) => this.renderReadingViewEmbeds(el, ctx));
		// Take precedence over Obsidian's own rendering of ![[...]], which would show "not found".
		this.registerEditorExtension(Prec.highest(livePreviewEmbeds(this)));
		this.registerView(DOC_VIEW_TYPE, (leaf) => new GoogleDocView(leaf, this));
		this.registerEvent(this.app.workspace.on("editor-paste", (event, editor) => this.embedPastedLink(event, editor)));
		this.registerEvent(this.app.workspace.on("css-change", () => this.updateDarkMode()));

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
		for (const kind of Object.keys(NEW_FILE_NAMES) as DocKind[]) {
			this.addCommand({
				id: `new-${kind}`,
				name: NEW_FILE_NAMES[kind],
				editorCallback: (editor) => this.createDocument(kind, editor),
			});
		}
		this.addCommand({
			id: "insert-from-drive",
			name: "Insert from Google Drive",
			editorCallback: (editor) => this.insertFromDrive(editor),
		});
		this.addSettingTab(new EmbedGoogleDocsSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// What the alias of ![[link|alias]] leaves out comes from the settings.
	embedOptions(alias: EmbedAlias): EmbedOptions {
		return {
			size: alias.size ?? { height: this.settings.defaultHeight },
			mode: alias.mode ?? this.settings.mode,
		};
	}

	// For the main window only: a webview in any other window (pop-outs, the settings
	// window) takes Obsidian down as soon as something in it gets focus, an Electron bug.
	// Set "src" after this; the partition has to be in place before the first navigation.
	createWebview(parent: HTMLElement): WebviewElement {
		const webview = parent.createEl("webview", {
			attr: {
				partition: PARTITION,
				useragent: this.settings.userAgent.trim() || chromeUserAgent(),
				// Obsidian denies pop-ups from webviews and opens their links in the browser instead;
				// without this attribute, links inside a document would do nothing.
				allowpopups: true,
			},
		});
		webview.addEventListener("dom-ready", () => webview.addClass("is-ready"));
		retryFailedLoadOnce(webview);
		return webview;
	}

	// Draws open embeds again from the current settings. Live preview keeps the
	// ones whose address and size stay the same; reading view renders anew.
	redrawEmbeds(): void {
		this.app.workspace.updateOptions();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
		});
	}

	reloadEmbeds(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaf.view.containerEl
				.querySelectorAll<WebviewElement>("webview.gdocs-embed-view.is-ready")
				.forEach((webview) => webview.reload());
		});
	}

	// Follows Obsidian's theme. The key of the inserted CSS is kept on the webview to take it out again.
	async applyDarkMode(webview: WebviewElement): Promise<void> {
		const dark = this.settings.darkDocuments && document.body.hasClass("theme-dark");
		const key = webview.dataset.darkCss;
		if (dark && !key) webview.dataset.darkCss = await webview.insertCSS(DARK_CSS);
		if (!dark && key) {
			delete webview.dataset.darkCss;
			await webview.removeInsertedCSS(key);
		}
	}

	updateDarkMode(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaf.view.containerEl
				.querySelectorAll<WebviewElement>("webview.gdocs-embed-view.is-ready")
				.forEach((webview) => void this.applyDarkMode(webview));
		});
	}

	openAccountModal(url: string): void {
		this.openInMainWindow(new GoogleAccountModal(this.app, this, url));
	}

	// Modals open in the active window; one holding a webview waits for the main window.
	private openInMainWindow(modal: Modal): void {
		if (activeWindow === window) {
			modal.open();
			return;
		}
		window.addEventListener("focus", () => modal.open(), { once: true });
		window.focus();
	}

	// A plain click opens a new tab; modifier keys pick a split or a window, as for links.
	async openInTab(url: string, title: string, event: MouseEvent): Promise<void> {
		const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(event) || "tab");
		await leaf.setViewState({ type: DOC_VIEW_TYPE, active: true, state: { url, title } });
	}

	private createDocument(kind: DocKind, editor: Editor): void {
		this.openInMainWindow(
			new NewDocumentModal(this.app, this, kind, (link) => editor.replaceSelection(embedSource(link, {}))),
		);
	}

	private insertFromDrive(editor: Editor): void {
		this.openInMainWindow(new DriveModal(this.app, this, (link) => editor.replaceSelection(embedSource(link, {}))));
	}

	// Embeds are blocks, so only a link pasted on a line of its own becomes one;
	// pasted into text, or over a selection, it stays a link.
	private embedPastedLink(event: ClipboardEvent, editor: Editor): void {
		const link = event.clipboardData!.getData("text/plain").trim();
		const onEmptyLine = !editor.somethingSelected() && !editor.getLine(editor.getCursor().line).trim();
		if (!this.settings.embedPastedLinks || event.defaultPrevented || !onEmptyLine || !parseGoogleDocUrl(link)) return;
		event.preventDefault();
		editor.replaceSelection(embedSource(link, {}));
	}

	private renderReadingViewEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		for (const placeholder of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed[src]"))) {
			const doc = parseGoogleDocUrl(placeholder.getAttribute("src")!);
			if (!doc) continue;
			const options = this.embedOptions(placeholderAlias(placeholder));
			// Swapping the element out keeps Obsidian from filling it with "not found".
			placeholder.replaceWith(
				createEmbed(this, doc, options, { onResize: (size) => void this.saveSizeInFile(el, ctx, doc, size) }),
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

// Obsidian puts the alias in "alt", but an alias that is only a size it may turn
// into attributes the way it does for images: "800x600" becomes width and height,
// a lone "600" becomes width. For us that is the height.
function placeholderAlias(placeholder: HTMLElement): EmbedAlias {
	const alias = parseAlias(placeholder.getAttribute("alt"));
	const width = placeholder.getAttribute("width");
	const height = placeholder.getAttribute("height");
	if (!alias.size && width) {
		alias.size = height ? { width: Number(width), height: Number(height) } : { height: Number(width) };
	}
	return alias;
}

// What Chrome sends on this OS, for the Chromium version Obsidian runs on.
function chromeUserAgent(): string {
	const os = Platform.isMacOS
		? "Macintosh; Intel Mac OS X 10_15_7"
		: Platform.isWin
			? "Windows NT 10.0; Win64; x64"
			: "X11; Linux x86_64";
	// User-Agent Client Hints, which TypeScript's DOM types do not cover yet.
	const { brands } = (navigator as Navigator & { userAgentData: { brands: { brand: string; version: string }[] } })
		.userAgentData;
	const major = brands.find((brand) => brand.brand === "Chromium")!.version;
	return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

class EmbedGoogleDocsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: EmbedGoogleDocsPlugin,
	) {
		super(app, plugin);
	}

	// Settings that open in a window of their own would cover the account window, which
	// opens in the main window. Once that window is gone, the main one is active again.
	private openAccountModal(url: string): void {
		const settingsWindow = this.containerEl.win;
		if (settingsWindow === window) {
			this.plugin.openAccountModal(url);
			return;
		}
		settingsWindow.addEventListener("pagehide", () => this.plugin.openAccountModal(url), { once: true });
		settingsWindow.close();
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		if (key === "mode" || key === "defaultHeight") this.plugin.redrawEmbeds();
		if (key === "darkDocuments") this.plugin.updateDarkMode();
	}

	// Controls read and write this.plugin.settings[key] and save it themselves.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Google account",
				desc: "Sign in once; every embed uses this session. Open embeds reload when the window closes.",
				render: (setting) => {
					setting
						.addButton((button) =>
							button
								.setButtonText("Sign in")
								.setCta()
								.onClick(() => this.openAccountModal(SIGN_IN_URL)),
						)
						.addButton((button) =>
							button.setButtonText("Sign out").onClick(() => this.openAccountModal(SIGN_OUT_URL)),
						);
				},
			},
			{
				name: "Embed mode",
				desc: "How documents open, unless the link names a mode, as in ![[link|preview]].",
				control: {
					type: "dropdown",
					key: "mode",
					options: { edit: "Editor", minimal: "Editor without menus", preview: "Read-only preview" },
				},
			},
			{
				name: "Default height",
				desc: "Height in pixels for links without a size, such as ![[link]] rather than ![[link|600]].",
				control: { type: "slider", key: "defaultHeight", min: 200, max: 1600, step: 50 },
			},
			{
				name: "Embed pasted links",
				desc: "Turn a Google Docs, Sheets or Slides link pasted on an empty line into an embed.",
				control: { type: "toggle", key: "embedPastedLinks" },
			},
			{
				name: "Dark documents",
				desc: "In a dark theme, show documents dark too by inverting their colors, pictures in them included.",
				control: { type: "toggle", key: "darkDocuments" },
			},
			{
				name: "User agent",
				desc: "Leave empty to send Chrome's user agent. Change it only if Google refuses the sign-in.",
				control: { type: "text", key: "userAgent", placeholder: chromeUserAgent() },
			},
		];
	}
}
