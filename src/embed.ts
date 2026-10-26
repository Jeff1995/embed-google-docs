import { setIcon } from "obsidian";
import { browserUrl, EmbedSize, embedUrl, GoogleDoc } from "./googleUrl";
import type EmbedGoogleDocsPlugin from "./main";

export interface WebviewElement extends HTMLElement {
	reload(): void;
}

interface EmbedCallbacks {
	onResize: (size: EmbedSize) => void;
	onEditSource?: () => void;
}

const KIND_LABELS = {
	document: "Google Docs",
	spreadsheets: "Google Sheets",
	presentation: "Google Slides",
};

const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;

export function createEmbed(
	plugin: EmbedGoogleDocsPlugin,
	doc: GoogleDoc,
	size: EmbedSize,
	callbacks: EmbedCallbacks,
): HTMLElement {
	const container = createDiv({ cls: "gdocs-embed", attr: { "data-doc-id": doc.id } });
	applySize(container, size);

	const header = container.createDiv({ cls: "gdocs-embed-header" });
	const title = header.createSpan({ cls: "gdocs-embed-title", text: KIND_LABELS[doc.kind] });
	const actions = header.createDiv({ cls: "gdocs-embed-actions" });

	// Created by the main window's document, the one the element is defined in.
	const host = document.createElement(WEBVIEW_HOST_TAG) as WebviewHost;
	host.addClass("gdocs-embed-body");
	host.createWebview = (ownerDocument) => {
		const webview = plugin.createWebview(ownerDocument);
		webview.addClass("gdocs-embed-view");
		webview.addEventListener("page-title-updated", (event) => {
			title.setText((event as Event & { title: string }).title);
		});
		webview.setAttribute("src", embedUrl(doc, plugin.settings.mode));
		return webview;
	};
	container.appendChild(host);

	if (callbacks.onEditSource) addAction(actions, "code-2", "Edit link", callbacks.onEditSource);
	addAction(actions, "rotate-cw", "Reload", () => host.querySelector<WebviewElement>("webview")?.reload());
	addAction(actions, "external-link", "Open in browser", () => window.open(browserUrl(doc)));

	const footer = container.createDiv({ cls: "gdocs-embed-footer" });
	addResizeHandle(container, footer.createDiv({ cls: "gdocs-embed-resize-height" }), false, callbacks.onResize);
	addResizeHandle(container, footer.createDiv({ cls: "gdocs-embed-resize-corner" }), true, callbacks.onResize);

	return container;
}

const WEBVIEW_HOST_TAG = "gdocs-webview-host";

// A <webview> only works in the window whose document created it, and Obsidian
// crashes when one is moved to another window, which is what dragging a tab into
// a new window does to everything in it. This element owns its webview: it drops
// the webview the moment it is detached (custom element callbacks run before the
// move completes) and builds a new one in whatever window it lands in.
class WebviewHost extends HTMLElement {
	createWebview?: (ownerDocument: Document) => WebviewElement;
	private observer?: IntersectionObserver;

	connectedCallback(): void {
		// Load only once on screen: each document is a whole browser page, and
		// Obsidian keeps the hidden editor or reading view of a note alive.
		this.observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			this.observer!.disconnect();
			this.appendChild(this.createWebview!(this.ownerDocument));
		});
		this.observer.observe(this);
	}

	disconnectedCallback(): void {
		this.observer!.disconnect();
		this.replaceChildren();
	}
}

// Custom elements cannot be redefined, so a plugin reload keeps the first definition.
export function registerWebviewHost(): void {
	if (!customElements.get(WEBVIEW_HOST_TAG)) customElements.define(WEBVIEW_HOST_TAG, WebviewHost);
}

export function applySize(container: HTMLElement, size: EmbedSize): void {
	container.setCssStyles({
		height: `${size.height}px`,
		width: size.width ? `${size.width}px` : "",
	});
}

function addAction(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
	const button = parent.createDiv({ cls: "clickable-icon gdocs-embed-action", attr: { "aria-label": label } });
	setIcon(button, icon);
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		onClick();
	});
}

function addResizeHandle(
	container: HTMLElement,
	handle: HTMLElement,
	resizesWidth: boolean,
	onResize: (size: EmbedSize) => void,
): void {
	handle.addEventListener("pointerdown", (down) => {
		down.preventDefault();
		down.stopPropagation();
		handle.setPointerCapture(down.pointerId);
		// The webview would otherwise swallow pointer events while the pointer is over it.
		container.addClass("is-resizing");

		const start = container.getBoundingClientRect();
		const maxWidth = container.parentElement!.clientWidth;

		const move = (event: PointerEvent) => {
			const height = Math.max(MIN_HEIGHT, start.height + event.clientY - down.clientY);
			container.setCssStyles({ height: `${height}px` });
			if (resizesWidth) {
				const width = Math.min(maxWidth, Math.max(MIN_WIDTH, start.width + event.clientX - down.clientX));
				container.setCssStyles({ width: `${width}px` });
			}
		};

		handle.addEventListener("pointermove", move);
		handle.addEventListener(
			"lostpointercapture",
			() => {
				handle.removeEventListener("pointermove", move);
				container.removeClass("is-resizing");
				onResize(measureSize(container, maxWidth));
			},
			{ once: true },
		);
	});
}

function measureSize(container: HTMLElement, maxWidth: number): EmbedSize {
	const height = Math.round(container.offsetHeight);
	const width = Math.round(container.offsetWidth);
	// Dragged out to the full width means "fill the note", so drop the fixed width.
	if (!container.style.width || width >= maxWidth) {
		container.setCssStyles({ width: "" });
		return { height };
	}
	return { width, height };
}
