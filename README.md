# opencode-file-browser

A file browser and viewer for the [OpenCode](https://opencode.ai) TUI: walk the
project folder inside the terminal, preview Markdown rendered, and read code
with syntax highlighting — without leaving OpenCode.

> Built for **OpenCode V2** (tested on v2.2.5). It is a TUI-only plugin, so it
> keeps working when the TUI is connected to a remote server.

```
  files ~/project                                                                 4 items
┌──────────────────────────────────┐┌──────────────────────────────────────────────────┐
│ ▸ docs/                         █││ README.md                          markdown · md │
│ ▸ src/                          █││ # demo-app                                      █│
│   package.json                  █││                                                 █│
│   README.md                     █││ A tiny example project used to show the         █│
│                                 █││ OpenCode file browser.                          █│
│                                 █││                                                 █│
│                                 █││ ## Getting started                              █│
│                                 █││ npm install                                     █│
│                                 █││ npm run dev                                     █│
│                                 █││                                                 █│
│                                 █││ ## Layout                                       █│
│                                 █││                                                 █│
│                                 █││ - `src/server.ts` — HTTP server                 █│
│                                 █││ - `docs/guide.md` — usage guide                 █│
│                                 █││                                                 █│
│                                 █││                                                 █│
│                                 █││                                                 █│
│                                 █││                                                 █│
│ ~/project                       ││                                                 █│
└──────────────────────────────────┘└──────────────────────────────────────────────────┘
 list / file ↑↓ enter ⌫ tab m r h f esc
```

## Features

- Folder navigation from the project (or session) directory, parents first.
- Markdown preview rendered by OpenTUI; press `m` to flip to the source.
- Code preview with tree-sitter highlighting (TypeScript, JS, Go, Rust, Python,
  JSON, YAML, shell, and many more).
- Two layouts, picked automatically:
  - **side panel** next to the chat while you are in a session;
  - **full page** from the home screen (no session).
- `f` toggles full screen in the panel, hiding the chat.
- Mouse and keyboard navigation.
- Reads through the OpenCode filesystem API, so it also works against a remote
  server.
- No dependencies beyond the ones OpenCode already provides.

## Install

### From GitHub (recommended)

```sh
opencode plugin add github:arthurrogado/opencode-file-browser
```

That installs the package and adds it to your global TUI config
(`~/.config/opencode/cli.json`). Restart OpenCode if the plugin list does not
refresh.

Using SSH instead:

```sh
opencode plugin add git+ssh://git@github.com/arthurrogado/opencode-file-browser.git
```

### Manual

Add the package to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["opencode-file-browser"]
}
```

Or point at a local checkout (useful for development):

```json
{
  "plugins": ["/home/you/dev/opencode-file-browser"]
}
```

You can also copy the folder into `~/.config/opencode/plugins/file-browser/`;
OpenCode discovers plugin directories there automatically.

## Usage

Run `opencode`, then:

- `/files` (aliases: `/browse`, `/arquivos`)
- `Ctrl+X` then `F`
- `Ctrl+P` → **Open file browser**

Inside a session it opens as a side panel; on the home screen it opens full
screen.

### Keys

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Move in the list (or scroll the file, depending on focus) |
| `Enter` | Open folder / file |
| `Tab` | Switch focus between list and file |
| `Backspace`, `u` | Go up one level |
| `PageUp` / `PageDown` | Page up / down |
| `g` / `Shift+G` | Start / end |
| `m` | Toggle rendered Markdown ↔ source |
| `r` | Reload the folder and the file |
| `h` | Show/hide dotfiles |
| `f` | Toggle full screen (panel only; hides the chat) |
| `Esc`, `q` | Close |

Clicking works too: click a folder to enter it, a file to open it.

## Configuration

Rebind the open command in `~/.config/opencode/cli.json`:

```json
{
  "keybinds": {
    "file-browser.open": "ctrl+shift+e"
  }
}
```

Disable the plugin:

```json
{
  "plugins": ["-file-browser"]
}
```

## How it works

- `context.ui.router.register` + `context.ui.slot("session.panel")` provide the
  two layouts.
- `context.client.file.list` / `context.client.file.read` use the OpenCode
  filesystem API.
- `<code>` and `<markdown>` from OpenTUI render the preview; the `SyntaxStyle`
  is built from `context.theme`, so it matches the active theme.
- The starting directory comes from the session location, falling back to the
  global location when there is no session.

## Limitations

- Read-only; it does not edit files.
- Files larger than 6,000 lines or 512 KB are truncated in the preview.
- Binary files (images, PDFs, …) show their size only.
- Navigation is confined to the project/session directory.

## Development

This repository uses the package layout that OpenCode resolves for TUI plugins
(`exports["./tui"]`). To try a local checkout, either add its path to
`cli.json` or symlink it into the discovery directory:

```sh
ln -s "$PWD" ~/.config/opencode/plugins/file-browser
```

OpenCode watches that directory and hot-reloads the plugin on save.

## Contributing

Issues and pull requests are welcome. Keep the plugin dependency-free: import
only `@opencode/plugin`, `@opentui/*`, and `solid-js`, which the host provides
at runtime.

## License

MIT
