# Embed Google Docs

An Obsidian plugin that shows live Google Docs, Sheets and Slides inside a note.
Paste a sharing link as an embed:

```markdown
![[https://docs.google.com/document/d/1AbC.../edit?usp=sharing]]
```

The document opens in place, fully interactive (scroll, read, edit, comment),
using the Google account you sign in with. Desktop only.

## Size and resizing

Drag the bar under an embed to change its height, or the corner to change
width and height. The new size is written into the link:

| Link                  | Size                          |
| --------------------- | ----------------------------- |
| `![[link]]`           | full width, default height    |
| `![[link\|600]]`      | full width, 600 px tall       |
| `![[link\|800x600]]`  | 800 px wide, 600 px tall      |

A single number is the **height** (unlike images, where it is the width), since
documents fill the note's width. Dragging the corner back to full width drops
the width again.

## Signing in

Run **Embed Google Docs: Sign in to Google** from the command palette, or use
the **Sign in** button in the plugin settings, and log in as you would in a
browser. All embeds share that session, and it persists across restarts. The
**Sign in** button Google shows inside an embed works too.

Obsidian's own web viewer cannot sign in to Google: Obsidian rewrites the
sign-in request headers on the sessions it creates, and Google rejects them.
This plugin keeps its embeds on a separate session (`persist:embed-google-docs`)
that Obsidian leaves alone, and sends Chrome's user agent. If Google ever
refuses the sign-in ("This browser or app may not be secure"), set a different
user agent in the settings, for example a current Firefox one.

## Settings

- **Embed mode**: the full editor, the editor without menus and toolbar, or a
  read-only preview.
- **Default height**: for links without a size.
- **User agent**: leave empty unless sign-in fails.

## Behavior worth knowing

- Each embed is a full browser page. Embeds load only when they scroll into
  view, and Obsidian unloads them again when they scroll far away, so they
  reload when you come back.
- In live preview, the link text shows while the cursor is on it, like
  Obsidian's own embeds. The `</>` button in the embed's header jumps there.
- Resizing in reading view rewrites the note, which re-renders and reloads the
  embed. Resizing in live preview does not reload it.
- Links clicked inside a document open the way Obsidian opens external links.
- Embeds inside code blocks are left as text.

## Install

```sh
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/embed-google-docs/`, then enable **Embed Google Docs**
under Settings → Community plugins. `npm run dev` rebuilds on every change.
