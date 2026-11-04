import { syntaxTree } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { applySize, createEmbed, EmbedOptions } from "./embed";
import { EMBED_PATTERN, EmbedSize, embedSource, embedUrl, GoogleDoc, parseAlias, parseGoogleDocUrl } from "./googleUrl";
import type EmbedGoogleDocsPlugin from "./main";

const EMBED_AT_START = new RegExp("^" + EMBED_PATTERN.source);

export function livePreviewEmbeds(plugin: EmbedGoogleDocsPlugin): StateField<DecorationSet> {
	return StateField.define<DecorationSet>({
		create: (state) => buildDecorations(state, plugin),
		update(decorations, tr) {
			const modeChanged = tr.startState.field(editorLivePreviewField) !== tr.state.field(editorLivePreviewField);
			// Reconfiguring, as workspace.updateOptions() does, picks up changed settings.
			const rebuild = tr.docChanged || tr.selection || modeChanged || tr.reconfigured;
			return rebuild ? buildDecorations(tr.state, plugin) : decorations;
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}

function buildDecorations(state: EditorState, plugin: EmbedGoogleDocsPlugin): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!state.field(editorLivePreviewField)) return builder.finish();

	const tree = syntaxTree(state);
	for (const match of state.doc.toString().matchAll(EMBED_PATTERN)) {
		const doc = parseGoogleDocUrl(match[1]);
		const from = match.index;
		const to = from + match[0].length;
		// Like Obsidian's own embeds, show the source while the cursor is on it.
		if (!doc || selectionTouches(state, from, to) || tree.resolveInner(from, 1).name.includes("code")) continue;

		const options = plugin.embedOptions(parseAlias(match[2]));
		// Obsidian draws embeds as block widgets, which beat inline ones whatever the precedence.
		builder.add(from, to, Decoration.replace({ widget: new GoogleDocWidget(plugin, doc, options), block: true }));
	}
	return builder.finish();
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

class GoogleDocWidget extends WidgetType {
	constructor(
		readonly plugin: EmbedGoogleDocsPlugin,
		readonly doc: GoogleDoc,
		readonly options: EmbedOptions,
	) {
		super();
	}

	get url(): string {
		return embedUrl(this.doc, this.options.mode);
	}

	eq(other: GoogleDocWidget): boolean {
		return (
			other.url === this.url &&
			other.options.size.width === this.options.size.width &&
			other.options.size.height === this.options.size.height
		);
	}

	// Resizing rewrites the link; reuse the element so the webview does not reload.
	updateDOM(dom: HTMLElement): boolean {
		const embed = dom.firstElementChild as HTMLElement;
		if (embed.dataset.url !== this.url) return false;
		applySize(embed, this.options.size);
		return true;
	}

	// Obsidian forces display: block on direct children of the editor, so the embed gets a wrapper.
	toDOM(view: EditorView): HTMLElement {
		const wrapper = createDiv({ cls: "gdocs-embed-block" });
		wrapper.appendChild(
			createEmbed(this.plugin, this.doc, this.options, {
				onResize: (size) => saveSize(view, wrapper, size),
				onEditSource: () => revealSource(view, wrapper),
			}),
		);
		return wrapper;
	}

	get estimatedHeight(): number {
		return this.options.size.height;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function saveSize(view: EditorView, embed: HTMLElement, size: EmbedSize): void {
	const from = view.posAtDOM(embed);
	const match = view.state.doc.sliceString(from, view.state.doc.lineAt(from).to).match(EMBED_AT_START)!;
	const source = embedSource(match[1], { ...parseAlias(match[2]), size });
	view.dispatch({ changes: { from, to: from + match[0].length, insert: source } });
}

function revealSource(view: EditorView, embed: HTMLElement): void {
	view.dispatch({ selection: { anchor: view.posAtDOM(embed) + "![[".length } });
	view.focus();
}
