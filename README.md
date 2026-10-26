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

## Network use and accounts

- **Google account**: viewing private documents and editing need a Google
  account. Public documents open without one.
- **Network**: embeds and the sign-in window load pages from Google
  (`docs.google.com`, `accounts.google.com` and whatever those pages load).
  The plugin contacts no other service, collects no data and sends nothing
  anywhere itself.
- **Session data**: the Google sign-in cookies are stored by Obsidian's
  Electron runtime in the `persist:embed-google-docs` session, outside your
  vault. **Sign out of Google** clears the login.

## Install

In Obsidian, open Settings → Community plugins → Browse, search for
**Embed Google Docs**, then install and enable it.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from
the [latest release](https://github.com/Jeff1995/embed-google-docs/releases/latest)
into `<vault>/.obsidian/plugins/embed-google-docs/`, then enable
**Embed Google Docs** under Settings → Community plugins.

## Development

```sh
npm install
npm run build   # or `npm run dev` to rebuild on every change
```

To release, set the new version in `manifest.json` and `package.json`, commit,
and push a tag with that version (`git tag 0.1.2 && git push origin 0.1.2`).
GitHub Actions builds the plugin, attests the files and publishes the release.

## License

[MIT](LICENSE)
