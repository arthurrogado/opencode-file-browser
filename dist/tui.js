import { createComponent as _$createComponent } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui";
import { MouseButton, SyntaxStyle, TextAttributes } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { ErrorBoundary, For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
const ROUTE = "file-browser";
const MAX_LINES = 6000;
const MAX_CHARS = 512 * 1024;
const MAX_LINE_CHARS = 4000;
const EXTENSIONS = {
  ".abap": "abap",
  ".bat": "bat",
  ".bib": "bibtex",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".coffee": "coffeescript",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".csx": "csharp",
  ".css": "css",
  ".d": "d",
  ".pas": "pascal",
  ".diff": "diff",
  ".patch": "diff",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".go": "go",
  ".groovy": "groovy",
  ".gleam": "gleam",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".ini": "ini",
  ".java": "java",
  ".jl": "julia",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".jsonc": "json",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".tex": "latex",
  ".less": "less",
  ".lua": "lua",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".pl": "perl",
  ".php": "php",
  ".ps1": "powershell",
  ".py": "python",
  ".r": "r",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sass": "sass",
  ".scala": "scala",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ksh": "bash",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".mtsx": "typescriptreact",
  ".ctsx": "typescriptreact",
  ".xml": "xml",
  ".xsl": "xsl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".vue": "vue",
  ".zig": "zig",
  ".zon": "zig",
  ".astro": "astro",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".tf": "terraform",
  ".tfvars": "terraform-vars",
  ".hcl": "hcl",
  ".nix": "nix",
  ".typ": "typst",
  ".typc": "typst"
};
const expandHome = value => {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2));
  return value;
};
const basename = path => {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
};
const extname = path => {
  const name = basename(path).toLowerCase();
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
};
const filetype = path => {
  const name = basename(path).toLowerCase();
  if (name === "makefile") return "makefile";
  if (name === "dockerfile") return "dockerfile";
  return EXTENSIONS[extname(path)] ?? "text";
};
const isMarkdown = path => {
  const ext = extname(path);
  return ext === ".md" || ext === ".markdown" || ext === ".mdx";
};
const parentOf = path => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};
const formatBytes = value => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

// Some native text buffers cannot handle pathologically long lines; clip them
// instead of risking a renderer failure on minified bundles or data files.
const clampLongLines = text => {
  let clipped = false;
  const lines = text.split("\n").map(line => {
    if (line.length <= MAX_LINE_CHARS) return line;
    clipped = true;
    return line.slice(0, MAX_LINE_CHARS) + " …";
  });
  return {
    text: lines.join("\n"),
    clipped
  };
};
const message = cause => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};
const isBinary = bytes => {
  const limit = Math.min(bytes.length, 8000);
  for (let index = 0; index < limit; index++) if (bytes[index] === 0) return true;
  return false;
};

// Mirrors the host theme's tree-sitter rules without importing @opencode/theme,
// which a local plugin cannot resolve at runtime.
function createSyntaxStyle(theme, owner) {
  const rule = (scope, foreground, extra = {}) => ({
    scope,
    style: {
      foreground,
      ...extra
    }
  });
  const syntax = theme.syntax;
  const markdown = theme.markdown;
  const feedback = theme.text.feedback;
  const rules = [rule(["default"], theme.text.base), rule(["comment", "comment.documentation"], syntax.comment, {
    italic: true
  }), rule(["string", "symbol", "character", "character.special"], syntax.string), rule(["number", "boolean", "constant", "float"], syntax.number), rule(["keyword", "keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], syntax.keyword, {
    italic: true
  }), rule(["keyword.type"], syntax.type, {
    bold: true,
    italic: true
  }), rule(["keyword.function", "function.method", "function", "constructor"], syntax.function), rule(["keyword.import", "string.escape", "string.regexp", "tag.attribute", "keyword.export"], syntax.keyword), rule(["operator", "keyword.operator", "punctuation.delimiter"], syntax.operator), rule(["variable", "variable.parameter", "property", "parameter", "field"], syntax.variable), rule(["variable.member", "function.method.call", "function.call"], syntax.function), rule(["type", "module", "class", "namespace"], syntax.type), rule(["punctuation", "punctuation.bracket"], syntax.punctuation), rule(["variable.builtin", "type.builtin", "function.builtin", "constant.builtin", "variable.super", "tag"], feedback.error.base), rule(["attribute", "annotation"], feedback.warning.base), rule(["comment.error"], feedback.error.base, {
    bold: true,
    italic: true
  }), rule(["comment.warning"], feedback.warning.base, {
    bold: true,
    italic: true
  }), rule(["comment.todo", "comment.note"], feedback.info.base, {
    bold: true,
    italic: true
  }), rule(["error"], feedback.error.base, {
    bold: true
  }), rule(["markup.heading", "markup.heading.2", "markup.heading.3"], markdown.heading, {
    bold: true
  }), rule(["markup.bold", "markup.strong"], markdown.strong, {
    bold: true
  }), rule(["markup.italic"], markdown.emphasis, {
    italic: true
  }), rule(["markup.quote"], markdown.blockQuote, {
    italic: true
  }), rule(["markup.raw", "markup.raw.block"], markdown.code), rule(["markup.link", "markup.link.url", "string.special.url"], markdown.link, {
    underline: true
  }), rule(["markup.list"], markdown.listItem), rule(["debug"], theme.text.muted)];
  return SyntaxStyle.fromTheme(rules, owner);
}
function FileBrowser(props) {
  const context = props.context;
  const theme = context.theme;
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [view, updateView] = context.storage.store("view", {
    initial: {
      fullscreen: false
    }
  });
  const syntax = createSyntaxStyle(theme, renderer.nativeScene);
  // Destroy only when this component unmounts. renderer.idle() resolves after
  // the next idle frame, not at teardown; destroying at setup kills the style
  // while <markdown>/<code> are still drawing with it.
  onCleanup(() => {
    void renderer.idle?.()?.then(() => syntax.destroy());
  });
  const surface = () => props.panel && props.panel.presentation === "panel" ? theme.background.raised.base : theme.background.base;
  const docked = () => props.panel !== undefined && props.panel.presentation === "panel";
  const [dir, setDir] = createSignal("");
  const [entries, setEntries] = createSignal([]);
  const [index, setIndex] = createSignal(0);
  const [focus, setFocus] = createSignal("list");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal();
  const [showHidden, setShowHidden] = createSignal(false);
  const [file, setFile] = createSignal();
  const [fileError, setFileError] = createSignal();
  const [rendered, setRendered] = createSignal(true);

  // A key that opens this view keeps dispatching until the next frame, so the
  // first instant after mount ignores keys that would immediately act on it.
  const mountedAt = Date.now();
  const fresh = () => Date.now() - mountedAt < 150;
  let listScroll;
  let contentScroll;
  // A hot reload or route change can dispose the renderables while a read is
  // still in flight; never touch a destroyed scrollbox.
  const content = () => contentScroll && !contentScroll.isDestroyed ? contentScroll : undefined;
  const list = () => listScroll && !listScroll.isDestroyed ? listScroll : undefined;
  const resetContentScroll = () => {
    if (renderer.isDestroyed) return;
    try {
      renderer.requestAnimationFrame(() => content()?.scrollTo(0));
    } catch {}
  };
  let listToken = 0;
  let readToken = 0;
  const current = () => entries()[index()];
  async function load(path, resetSelection = true) {
    const token = ++listToken;
    setLoading(true);
    setError(undefined);
    try {
      const result = await context.client.file.list({
        location: props.location(),
        path: path || undefined
      });
      if (token !== listToken) return;
      const items = result.data.filter(entry => showHidden() || !basename(entry.path).startsWith(".")).map(entry => ({
        path: entry.path.replace(/\/+$/, ""),
        type: entry.type
      })).sort((left, right) => {
        if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
        return basename(left.path).localeCompare(basename(right.path));
      });
      setEntries(items);
      setDir(path);
      const previous = index();
      setIndex(resetSelection ? 0 : Math.min(previous, Math.max(0, items.length - 1)));
    } catch (cause) {
      if (token !== listToken) return;
      setEntries([]);
      setError(message(cause));
    } finally {
      if (token === listToken) setLoading(false);
    }
  }
  async function show(target, external) {
    const token = ++readToken;
    setFileError(undefined);
    setRendered(true);
    setFocus("content");
    try {
      const bytes = external ? new Uint8Array(await readFile(target)) : await context.client.file.read({
        location: props.location(),
        path: target
      });
      if (token !== readToken) return;
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (isBinary(data)) {
        setFile(undefined);
        setFileError(`Binary file · ${formatBytes(data.length)}`);
        return;
      }
      let text = new TextDecoder("utf-8").decode(data);
      let truncated = false;
      const lines = text.split("\n");
      if (lines.length > MAX_LINES) {
        text = lines.slice(0, MAX_LINES).join("\n");
        truncated = true;
      }
      if (text.length > MAX_CHARS) {
        text = text.slice(0, MAX_CHARS);
        truncated = true;
      }
      const clamped = clampLongLines(text);
      text = clamped.text;
      truncated = truncated || clamped.clipped;
      setFile({
        path: target,
        external,
        text,
        type: filetype(target),
        markdown: isMarkdown(target),
        truncated
      });
      resetContentScroll();
    } catch (cause) {
      if (token === readToken) {
        setFile(undefined);
        setFileError(message(cause));
      }
    }
  }
  async function read(entry) {
    await show(entry.path, false);
  }

  // Project files go through the server (works with remote servers). Anything
  // outside the project is read from this machine with node:fs instead.
  function relativeToLocation(target) {
    const relative = path.relative(props.location().directory, target);
    if (!relative) return "";
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return relative;
  }
  async function openPath(input) {
    const value = input.trim();
    if (!value) return;
    const base = dir() ? path.join(props.location().directory, dir()) : props.location().directory;
    const target = path.resolve(base, expandHome(value));
    const relative = relativeToLocation(target);
    const info = await stat(target).catch(() => undefined);
    if (info?.isDirectory()) {
      if (relative === undefined) {
        setFile(undefined);
        setFileError("That directory is outside the project.");
        return;
      }
      setFile(undefined);
      setFileError(undefined);
      setFocus("list");
      await load(relative);
      return;
    }
    if (!info) {
      setFile(undefined);
      setFileError(`Not found: ${target}`);
      return;
    }
    await show(relative ?? target, relative === undefined);
  }
  async function promptPath() {
    const value = await context.ui.dialog.prompt({
      title: "Open file by path",
      description: "Absolute path, or relative to the current folder. ~ points to your home.",
      placeholder: "/path/to/file or ../notes.md"
    });
    if (value) await openPath(value);
  }
  function open(entry) {
    if (entry.type === "directory") {
      setFile(undefined);
      setFileError(undefined);
      setFocus("list");
      void load(entry.path);
      return;
    }
    void read(entry);
  }
  function move(delta) {
    if (focus() === "list") {
      const total = entries().length;
      if (total === 0) return;
      setIndex(value => Math.max(0, Math.min(total - 1, value + delta)));
      return;
    }
    content()?.scrollBy(delta);
  }
  function page(direction) {
    if (focus() === "list") {
      move(direction * Math.max(1, Math.floor(dimensions().height / 2)));
      return;
    }
    const scroll = content();
    if (!scroll) return;
    scroll.scrollBy(direction * Math.max(1, Math.floor(scroll.viewport.height / 2)));
  }
  function goParent() {
    if (focus() === "content") {
      setFocus("list");
      return;
    }
    if (!dir()) return;
    void load(parentOf(dir()));
  }
  function reload() {
    const active = file();
    if (active) void show(active.path, active.external);
    void load(dir(), false);
  }
  function toggleMarkdown() {
    if (!file()?.markdown) return;
    setRendered(value => !value);
    resetContentScroll();
  }
  function toggleFullscreen() {
    const panel = props.panel;
    if (!panel) return;
    const before = panel.presentation;
    panel.toggleFullscreen();
    if (panel.presentation === before) return;
    void updateView(draft => {
      draft.fullscreen = panel.presentation === "fullscreen";
    });
  }
  function toggleHidden() {
    setShowHidden(value => !value);
    void load(dir(), false);
  }
  const commands = [{
    id: "file-browser.close",
    title: "Close file browser",
    group: "Files",
    bind: "escape,q",
    run: () => props.onClose()
  }, {
    id: "file-browser.down",
    title: "Next item",
    group: "Files",
    bind: "down,j",
    run: () => move(1)
  }, {
    id: "file-browser.up",
    title: "Previous item",
    group: "Files",
    bind: "up,k",
    run: () => move(-1)
  }, {
    id: "file-browser.select",
    title: "Open selected item",
    group: "Files",
    bind: "return,space",
    run: () => {
      if (fresh()) return;
      const entry = current();
      if (entry) open(entry);
    }
  }, {
    id: "file-browser.parent",
    title: "Go up one level",
    group: "Files",
    bind: "backspace,u",
    run: goParent
  }, {
    id: "file-browser.focus",
    title: "Toggle list/file focus",
    group: "Files",
    bind: "tab",
    run: () => setFocus(value => value === "list" ? "content" : "list")
  }, {
    id: "file-browser.page_down",
    title: "Page down",
    group: "Files",
    bind: "pagedown,ctrl+f",
    run: () => page(1)
  }, {
    id: "file-browser.page_up",
    title: "Page up",
    group: "Files",
    bind: "pageup,ctrl+b",
    run: () => page(-1)
  }, {
    id: "file-browser.first",
    title: "Go to start",
    group: "Files",
    bind: "g,home",
    run: () => {
      if (focus() === "list") setIndex(0);else content()?.scrollTo(0);
    }
  }, {
    id: "file-browser.last",
    title: "Go to end",
    group: "Files",
    bind: "shift+g,end",
    run: () => {
      if (focus() === "list") setIndex(Math.max(0, entries().length - 1));else {
        const scroll = content();
        if (scroll) scroll.scrollTo(scroll.scrollHeight);
      }
    }
  }, {
    id: "file-browser.markdown",
    title: "Toggle Markdown/source",
    group: "Files",
    bind: "m",
    run: toggleMarkdown
  }, {
    id: "file-browser.reload",
    title: "Reload",
    group: "Files",
    bind: "r",
    run: reload
  }, {
    id: "file-browser.hidden",
    title: "Toggle hidden files",
    group: "Files",
    bind: "h",
    run: toggleHidden
  }, {
    id: "file-browser.path",
    title: "Open file by path",
    group: "Files",
    bind: "o",
    run: () => void promptPath()
  }, {
    id: "file-browser.fullscreen",
    title: "Toggle fullscreen",
    group: "Files",
    bind: "f",
    run: () => {
      if (fresh()) return;
      toggleFullscreen();
    }
  }];
  context.keymap.layer(() => ({
    priority: 100,
    enabled: () => props.panel ? props.panel.focused : true,
    commands
  }));

  // The panel is mounted once per open; load the root of the session location.
  onMount(() => void load(""));

  // Requests from the global "open by path" command arrive through shared
  // in-memory state, since the browser may mount after the prompt resolves.
  const [pending, updatePending] = context.storage.memory("pending", {
    initial: {
      seq: 0
    }
  });
  createEffect(() => {
    const request = pending.path;
    if (!request) return;
    void updatePending(draft => {
      draft.path = undefined;
    });
    void openPath(request);
  });
  let lastRoot;
  createEffect(() => {
    const root = props.location().directory;
    if (root === lastRoot) return;
    lastRoot = root;
    setFile(undefined);
    setFileError(undefined);
    setFocus("list");
    void load("");
  });

  // Keep the selected row visible while navigating with the keyboard.
  createEffect(() => {
    const selected = index();
    const total = entries().length;
    if (total === 0) return;
    const scroll = list();
    if (!scroll || scroll.isDestroyed) return;
    if (selected < scroll.scrollTop) scroll.scrollTo(selected);else if (selected + 1 > scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(selected + 1 - scroll.viewport.height);
  });
  const availableWidth = () => props.panel ? props.panel.width : dimensions().width;
  const listWidth = () => Math.max(20, Math.min(42, Math.floor(availableWidth() * 0.3)));
  const breadcrumb = () => {
    const root = context.ui.format.path(props.location().directory);
    const rest = dir();
    return rest ? `${root}/${rest}` : root;
  };
  const Row = props2 => {
    const [hovered, setHovered] = createSignal(false);
    const directory = () => props2.entry.type === "directory";
    return (() => {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "flexDirection", "row");
      _$setProp(_el$, "height", 1);
      _$setProp(_el$, "flexShrink", 0);
      _$setProp(_el$, "paddingLeft", 1);
      _$setProp(_el$, "paddingRight", 1);
      _$setProp(_el$, "onMouseOver", () => setHovered(true));
      _$setProp(_el$, "onMouseOut", () => setHovered(false));
      _$setProp(_el$, "onMouseUp", event => {
        if (event.button !== MouseButton.LEFT) return;
        event.stopPropagation();
        setFocus("list");
        setIndex(entries().indexOf(props2.entry));
        open(props2.entry);
      });
      _$setProp(_el$2, "wrapMode", "none");
      _$setProp(_el$2, "truncate", true);
      _$setProp(_el$2, "selectable", false);
      _$insert(_el$2, () => directory() ? "▸ " : "  ", null);
      _$insert(_el$2, () => basename(props2.entry.path), null);
      _$insert(_el$2, () => directory() ? "/" : "", null);
      _$effect(_p$ => {
        var _v$ = props2.active ? theme.background.raised.max : hovered() ? theme.background.raised.high : surface(),
          _v$2 = props2.active ? theme.text.action.primary.selected : directory() ? theme.text.action.secondary.base : theme.text.base,
          _v$3 = props2.active ? TextAttributes.BOLD : 0;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$2, "attributes", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$;
    })();
  };
  return (() => {
    var _el$3 = _$createElement("box"),
      _el$4 = _$createElement("box"),
      _el$5 = _$createElement("text"),
      _el$7 = _$createElement("text"),
      _el$8 = _$createElement("text"),
      _el$9 = _$createElement("box"),
      _el$0 = _$createElement("box"),
      _el$1 = _$createElement("scrollbox"),
      _el$13 = _$createElement("box"),
      _el$14 = _$createElement("text"),
      _el$15 = _$createElement("box"),
      _el$16 = _$createElement("box"),
      _el$17 = _$createElement("text"),
      _el$23 = _$createElement("box"),
      _el$24 = _$createElement("text"),
      _el$26 = _$createElement("text"),
      _el$28 = _$createElement("text"),
      _el$30 = _$createElement("text"),
      _el$31 = _$createTextNode(`↑↓ enter ⌫ tab m r h o `),
      _el$32 = _$createTextNode(`esc`);
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$9);
    _$insertNode(_el$3, _el$23);
    _$setProp(_el$3, "width", "100%");
    _$setProp(_el$3, "height", "100%");
    _$setProp(_el$3, "flexDirection", "column");
    _$insertNode(_el$4, _el$5);
    _$insertNode(_el$4, _el$7);
    _$insertNode(_el$4, _el$8);
    _$setProp(_el$4, "paddingLeft", 2);
    _$setProp(_el$4, "paddingRight", 2);
    _$setProp(_el$4, "flexShrink", 0);
    _$setProp(_el$4, "flexDirection", "row");
    _$setProp(_el$4, "gap", 1);
    _$insertNode(_el$5, _$createTextNode(`files`));
    _$setProp(_el$5, "wrapMode", "none");
    _$setProp(_el$5, "flexShrink", 0);
    _$setProp(_el$7, "wrapMode", "none");
    _$setProp(_el$7, "truncate", true);
    _$setProp(_el$7, "flexGrow", 1);
    _$setProp(_el$7, "minWidth", 0);
    _$insert(_el$7, breadcrumb);
    _$setProp(_el$8, "wrapMode", "none");
    _$setProp(_el$8, "flexShrink", 0);
    _$insert(_el$8, (() => {
      var _c$ = _$memo(() => !!loading());
      return () => _c$() ? "loading…" : _$memo(() => !!error())() ? "error" : `${entries().length} ${entries().length === 1 ? "item" : "items"}`;
    })());
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$15);
    _$setProp(_el$9, "flexDirection", "row");
    _$setProp(_el$9, "flexGrow", 1);
    _$setProp(_el$9, "minHeight", 0);
    _$insertNode(_el$0, _el$1);
    _$insertNode(_el$0, _el$13);
    _$setProp(_el$0, "flexShrink", 0);
    _$setProp(_el$0, "flexDirection", "column");
    _$setProp(_el$0, "minHeight", 0);
    _$setProp(_el$0, "border", true);
    _$use(element => listScroll = element, _el$1);
    _$setProp(_el$1, "flexGrow", 1);
    _$setProp(_el$1, "minHeight", 0);
    _$setProp(_el$1, "verticalScrollbarOptions", {
      visible: true
    });
    _$setProp(_el$1, "scrollAcceleration", undefined);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$10 = _$createElement("text");
        _$setProp(_el$10, "paddingLeft", 1);
        _$setProp(_el$10, "paddingRight", 1);
        _$setProp(_el$10, "wrapMode", "word");
        _$insert(_el$10, error);
        _$effect(_$p => _$setProp(_el$10, "fg", theme.text.feedback.error.base, _$p));
        return _el$10;
      }
    }), null);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!(!error() && !loading()))() && entries().length === 0;
      },
      get children() {
        var _el$11 = _$createElement("text");
        _$insertNode(_el$11, _$createTextNode(`(empty)`));
        _$setProp(_el$11, "paddingLeft", 1);
        _$effect(_$p => _$setProp(_el$11, "fg", theme.text.muted, _$p));
        return _el$11;
      }
    }), null);
    _$insert(_el$1, _$createComponent(For, {
      get each() {
        return entries();
      },
      children: (entry, position) => _$createComponent(Row, {
        entry: entry,
        get active() {
          return position() === index();
        }
      })
    }), null);
    _$insertNode(_el$13, _el$14);
    _$setProp(_el$13, "height", 1);
    _$setProp(_el$13, "flexShrink", 0);
    _$setProp(_el$13, "paddingLeft", 1);
    _$setProp(_el$13, "paddingRight", 1);
    _$setProp(_el$13, "flexDirection", "row");
    _$setProp(_el$14, "wrapMode", "none");
    _$setProp(_el$14, "truncate", true);
    _$insert(_el$14, (() => {
      var _c$2 = _$memo(() => !!dir());
      return () => _c$2() ? "../" : context.ui.format.path(props.location().directory);
    })());
    _$insertNode(_el$15, _el$16);
    _$setProp(_el$15, "flexGrow", 1);
    _$setProp(_el$15, "minWidth", 0);
    _$setProp(_el$15, "minHeight", 0);
    _$setProp(_el$15, "flexDirection", "column");
    _$setProp(_el$15, "border", true);
    _$insertNode(_el$16, _el$17);
    _$setProp(_el$16, "height", 1);
    _$setProp(_el$16, "flexShrink", 0);
    _$setProp(_el$16, "flexDirection", "row");
    _$setProp(_el$16, "paddingLeft", 1);
    _$setProp(_el$16, "paddingRight", 1);
    _$setProp(_el$16, "gap", 1);
    _$setProp(_el$17, "wrapMode", "none");
    _$setProp(_el$17, "truncate", true);
    _$setProp(_el$17, "flexGrow", 1);
    _$setProp(_el$17, "minWidth", 0);
    _$insert(_el$17, (() => {
      var _c$3 = _$memo(() => !!file());
      return () => _c$3() ? _$memo(() => !!file().external)() ? context.ui.format.path(file().path) : basename(file().path) : "";
    })());
    _$insert(_el$16, _$createComponent(Show, {
      get when() {
        return file();
      },
      children: active => (() => {
        var _el$33 = _$createElement("text");
        _$setProp(_el$33, "wrapMode", "none");
        _$setProp(_el$33, "flexShrink", 0);
        _$insert(_el$33, () => active().type, null);
        _$insert(_el$33, () => active().external ? " · external" : "", null);
        _$insert(_el$33, () => active().truncated ? " · truncated" : "", null);
        _$insert(_el$33, (() => {
          var _c$4 = _$memo(() => !!active().markdown);
          return () => _c$4() ? rendered() ? " · md" : " · source" : "";
        })(), null);
        _$effect(_$p => _$setProp(_el$33, "fg", theme.text.muted, _$p));
        return _el$33;
      })()
    }), null);
    _$insert(_el$15, _$createComponent(Show, {
      get when() {
        return fileError();
      },
      get children() {
        var _el$18 = _$createElement("box"),
          _el$19 = _$createElement("text");
        _$insertNode(_el$18, _el$19);
        _$setProp(_el$18, "flexGrow", 1);
        _$setProp(_el$18, "padding", 1);
        _$setProp(_el$19, "wrapMode", "word");
        _$insert(_el$19, fileError);
        _$effect(_$p => _$setProp(_el$19, "fg", theme.text.feedback.error.base, _$p));
        return _el$18;
      }
    }), null);
    _$insert(_el$15, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!fileError())() && !file();
      },
      get children() {
        var _el$20 = _$createElement("box"),
          _el$21 = _$createElement("text");
        _$insertNode(_el$20, _el$21);
        _$setProp(_el$20, "flexGrow", 1);
        _$setProp(_el$20, "padding", 1);
        _$insertNode(_el$21, _$createTextNode(`Select a file on the left and press Enter.`));
        _$setProp(_el$21, "wrapMode", "word");
        _$effect(_$p => _$setProp(_el$21, "fg", theme.text.muted, _$p));
        return _el$20;
      }
    }), null);
    _$insert(_el$15, _$createComponent(ErrorBoundary, {
      fallback: error => (() => {
        var _el$34 = _$createElement("box"),
          _el$35 = _$createElement("text"),
          _el$36 = _$createTextNode(`Could not render this file: `);
        _$insertNode(_el$34, _el$35);
        _$setProp(_el$34, "flexGrow", 1);
        _$setProp(_el$34, "padding", 1);
        _$insertNode(_el$35, _el$36);
        _$setProp(_el$35, "wrapMode", "word");
        _$insert(_el$35, () => message(error), null);
        _$effect(_$p => _$setProp(_el$35, "fg", theme.text.feedback.error.base, _$p));
        return _el$34;
      })(),
      get children() {
        return _$createComponent(Show, {
          get when() {
            return _$memo(() => !!!fileError())() && file();
          },
          children: active => _$createComponent(Show, {
            get when() {
              return _$memo(() => !!active().markdown)() && rendered();
            },
            get fallback() {
              return (() => {
                var _el$42 = _$createElement("scrollbox"),
                  _el$43 = _$createElement("box"),
                  _el$44 = _$createElement("code");
                _$insertNode(_el$42, _el$43);
                _$use(element => contentScroll = element, _el$42);
                _$setProp(_el$42, "flexGrow", 1);
                _$setProp(_el$42, "minHeight", 0);
                _$setProp(_el$42, "verticalScrollbarOptions", {
                  visible: true
                });
                _$insertNode(_el$43, _el$44);
                _$setProp(_el$43, "paddingLeft", 1);
                _$setProp(_el$43, "paddingRight", 1);
                _$setProp(_el$43, "flexShrink", 0);
                _$setProp(_el$44, "syntaxStyle", syntax);
                _$setProp(_el$44, "wrapMode", "word");
                _$insert(_el$42, _$createComponent(Show, {
                  get when() {
                    return active().truncated;
                  },
                  get children() {
                    var _el$45 = _$createElement("text");
                    _$insertNode(_el$45, _$createTextNode(`… content truncated for display`));
                    _$setProp(_el$45, "paddingLeft", 1);
                    _$setProp(_el$45, "paddingTop", 1);
                    _$effect(_$p => _$setProp(_el$45, "fg", theme.text.muted, _$p));
                    return _el$45;
                  }
                }), null);
                _$effect(_p$ => {
                  var _v$27 = active().text,
                    _v$28 = active().type;
                  _v$27 !== _p$.e && (_p$.e = _$setProp(_el$44, "content", _v$27, _p$.e));
                  _v$28 !== _p$.t && (_p$.t = _$setProp(_el$44, "filetype", _v$28, _p$.t));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined
                });
                return _el$42;
              })();
            },
            get children() {
              var _el$37 = _$createElement("scrollbox"),
                _el$38 = _$createElement("box"),
                _el$39 = _$createElement("markdown");
              _$insertNode(_el$37, _el$38);
              _$use(element => contentScroll = element, _el$37);
              _$setProp(_el$37, "flexGrow", 1);
              _$setProp(_el$37, "minHeight", 0);
              _$setProp(_el$37, "verticalScrollbarOptions", {
                visible: true
              });
              _$insertNode(_el$38, _el$39);
              _$setProp(_el$38, "paddingLeft", 1);
              _$setProp(_el$38, "paddingRight", 1);
              _$setProp(_el$38, "flexShrink", 0);
              _$setProp(_el$39, "syntaxStyle", syntax);
              _$setProp(_el$39, "conceal", true);
              _$insert(_el$37, _$createComponent(Show, {
                get when() {
                  return active().truncated;
                },
                get children() {
                  var _el$40 = _$createElement("text");
                  _$insertNode(_el$40, _$createTextNode(`… content truncated for display`));
                  _$setProp(_el$40, "paddingLeft", 1);
                  _$setProp(_el$40, "paddingTop", 1);
                  _$effect(_$p => _$setProp(_el$40, "fg", theme.text.muted, _$p));
                  return _el$40;
                }
              }), null);
              _$effect(_p$ => {
                var _v$24 = active().text,
                  _v$25 = theme.markdown.text,
                  _v$26 = surface();
                _v$24 !== _p$.e && (_p$.e = _$setProp(_el$39, "content", _v$24, _p$.e));
                _v$25 !== _p$.t && (_p$.t = _$setProp(_el$39, "fg", _v$25, _p$.t));
                _v$26 !== _p$.a && (_p$.a = _$setProp(_el$39, "bg", _v$26, _p$.a));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$37;
            }
          })
        });
      }
    }), null);
    _$insertNode(_el$23, _el$24);
    _$insertNode(_el$23, _el$26);
    _$insertNode(_el$23, _el$28);
    _$insertNode(_el$23, _el$30);
    _$setProp(_el$23, "height", 1);
    _$setProp(_el$23, "flexShrink", 0);
    _$setProp(_el$23, "paddingRight", 2);
    _$setProp(_el$23, "flexDirection", "row");
    _$setProp(_el$23, "gap", 1);
    _$insertNode(_el$24, _$createTextNode(`list`));
    _$setProp(_el$24, "wrapMode", "none");
    _$setProp(_el$24, "flexShrink", 0);
    _$insertNode(_el$26, _$createTextNode(`/`));
    _$setProp(_el$26, "wrapMode", "none");
    _$setProp(_el$26, "flexShrink", 0);
    _$insertNode(_el$28, _$createTextNode(`file`));
    _$setProp(_el$28, "wrapMode", "none");
    _$setProp(_el$28, "flexShrink", 0);
    _$insertNode(_el$30, _el$31);
    _$insertNode(_el$30, _el$32);
    _$setProp(_el$30, "wrapMode", "none");
    _$setProp(_el$30, "truncate", true);
    _$setProp(_el$30, "flexGrow", 1);
    _$setProp(_el$30, "minWidth", 0);
    _$insert(_el$30, () => props.panel ? "f " : "", _el$32);
    _$effect(_p$ => {
      var _v$4 = surface(),
        _v$5 = docked() ? 2 : 1,
        _v$6 = docked() ? 1 : 0,
        _v$7 = theme.text.base,
        _v$8 = TextAttributes.BOLD,
        _v$9 = theme.text.muted,
        _v$0 = error() ? theme.text.feedback.error.base : theme.text.muted,
        _v$1 = docked() ? 2 : 0,
        _v$10 = docked() ? 2 : 0,
        _v$11 = listWidth(),
        _v$12 = focus() === "list" ? theme.border.base : theme.background.raised.base,
        _v$13 = surface(),
        _v$14 = theme.text.muted,
        _v$15 = focus() === "content" ? theme.border.base : theme.background.raised.base,
        _v$16 = surface(),
        _v$17 = theme.text.base,
        _v$18 = TextAttributes.BOLD,
        _v$19 = docked() ? 2 : 1,
        _v$20 = focus() === "list" ? theme.text.base : theme.text.muted,
        _v$21 = theme.text.muted,
        _v$22 = focus() === "content" ? theme.text.base : theme.text.muted,
        _v$23 = theme.text.muted;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$3, "backgroundColor", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$4, "height", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp(_el$4, "paddingTop", _v$6, _p$.a));
      _v$7 !== _p$.o && (_p$.o = _$setProp(_el$5, "fg", _v$7, _p$.o));
      _v$8 !== _p$.i && (_p$.i = _$setProp(_el$5, "attributes", _v$8, _p$.i));
      _v$9 !== _p$.n && (_p$.n = _$setProp(_el$7, "fg", _v$9, _p$.n));
      _v$0 !== _p$.s && (_p$.s = _$setProp(_el$8, "fg", _v$0, _p$.s));
      _v$1 !== _p$.h && (_p$.h = _$setProp(_el$9, "paddingLeft", _v$1, _p$.h));
      _v$10 !== _p$.r && (_p$.r = _$setProp(_el$9, "paddingRight", _v$10, _p$.r));
      _v$11 !== _p$.d && (_p$.d = _$setProp(_el$0, "width", _v$11, _p$.d));
      _v$12 !== _p$.l && (_p$.l = _$setProp(_el$0, "borderColor", _v$12, _p$.l));
      _v$13 !== _p$.u && (_p$.u = _$setProp(_el$0, "backgroundColor", _v$13, _p$.u));
      _v$14 !== _p$.c && (_p$.c = _$setProp(_el$14, "fg", _v$14, _p$.c));
      _v$15 !== _p$.w && (_p$.w = _$setProp(_el$15, "borderColor", _v$15, _p$.w));
      _v$16 !== _p$.m && (_p$.m = _$setProp(_el$15, "backgroundColor", _v$16, _p$.m));
      _v$17 !== _p$.f && (_p$.f = _$setProp(_el$17, "fg", _v$17, _p$.f));
      _v$18 !== _p$.y && (_p$.y = _$setProp(_el$17, "attributes", _v$18, _p$.y));
      _v$19 !== _p$.g && (_p$.g = _$setProp(_el$23, "paddingLeft", _v$19, _p$.g));
      _v$20 !== _p$.p && (_p$.p = _$setProp(_el$24, "fg", _v$20, _p$.p));
      _v$21 !== _p$.b && (_p$.b = _$setProp(_el$26, "fg", _v$21, _p$.b));
      _v$22 !== _p$.T && (_p$.T = _$setProp(_el$28, "fg", _v$22, _p$.T));
      _v$23 !== _p$.A && (_p$.A = _$setProp(_el$30, "fg", _v$23, _p$.A));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined,
      c: undefined,
      w: undefined,
      m: undefined,
      f: undefined,
      y: undefined,
      g: undefined,
      p: undefined,
      b: undefined,
      T: undefined,
      A: undefined
    });
    return _el$3;
  })();
}
function BrowserRoute(props) {
  const dimensions = useTerminalDimensions();
  const location = () => props.data?.directory ? {
    directory: props.data.directory
  } : props.context.location ?? props.context.data.location.default();
  return (() => {
    var _el$47 = _$createElement("box");
    _$setProp(_el$47, "position", "absolute");
    _$setProp(_el$47, "zIndex", 2500);
    _$setProp(_el$47, "left", 0);
    _$setProp(_el$47, "top", 0);
    _$insert(_el$47, _$createComponent(FileBrowser, {
      get context() {
        return props.context;
      },
      location: location,
      onClose: () => props.context.ui.router.navigate(props.data?.returnRoute ?? {
        type: "home"
      })
    }));
    _$effect(_p$ => {
      var _v$29 = dimensions().width,
        _v$30 = dimensions().height;
      _v$29 !== _p$.e && (_p$.e = _$setProp(_el$47, "width", _v$29, _p$.e));
      _v$30 !== _p$.t && (_p$.t = _$setProp(_el$47, "height", _v$30, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$47;
  })();
}
function Commands(props) {
  const [view] = props.context.storage.store("view", {
    initial: {
      fullscreen: false
    }
  });
  const [, updatePending] = props.context.storage.memory("pending", {
    initial: {
      seq: 0
    }
  });
  const ensureOpen = () => {
    const route = props.context.ui.router.current();
    const panel = props.context.ui.panel.current();
    if (route.type === "session" && panel?.sessionID === route.sessionID && panel.name === ROUTE) return;
    if (route.type === "plugin" && route.name === ROUTE) return;
    if (props.context.ui.panel.open(ROUTE, {
      presentation: view.fullscreen ? "fullscreen" : "panel"
    })) return;
    const returnRoute = route.type === "home" ? {
      type: "home"
    } : route.type === "session" ? {
      type: "session",
      sessionID: route.sessionID
    } : {
      type: "plugin",
      id: route.id,
      name: route.name,
      ...(route.data ? {
        data: {
          ...route.data
        }
      } : {})
    };
    // Defer so the key that opened us finishes dispatching before the route
    // mounts its own keymap layer.
    setTimeout(() => props.context.ui.router.navigate({
      type: "plugin",
      name: ROUTE,
      data: {
        sessionID: route.type === "session" ? route.sessionID : undefined,
        directory: route.type === "session" ? props.context.data.session.get(route.sessionID)?.location?.directory ?? props.context.data.location.default().directory : props.context.data.location.default().directory,
        returnRoute
      }
    }), 0);
  };
  const askPath = async () => {
    const value = await props.context.ui.dialog.prompt({
      title: "Open file by path",
      description: "Absolute path, or relative to the current folder. ~ points to your home.",
      placeholder: "/path/to/file or ../notes.md"
    });
    const target = value?.trim();
    if (!target) return;
    void updatePending(draft => {
      draft.path = target;
      draft.seq += 1;
    });
    ensureOpen();
  };
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "file-browser.open",
      title: "Open file browser",
      description: "Browse folders and preview Markdown and code",
      group: "Files",
      palette: true,
      suggested: true,
      slash: {
        name: "files",
        aliases: ["browse", "arquivos"]
      },
      bind: "<leader>f",
      run() {
        const route = props.context.ui.router.current();
        props.context.ui.dialog.clear();
        if (route.type === "plugin" && route.name === ROUTE) {
          const back = route.data?.returnRoute ?? {
            type: "home"
          };
          props.context.ui.router.navigate(back.type === "plugin" && back.name === ROUTE ? {
            type: "home"
          } : back);
          return;
        }
        const panel = props.context.ui.panel.current();
        if (route.type === "session" && panel?.sessionID === route.sessionID && panel.name === ROUTE) {
          props.context.ui.panel.close();
          return;
        }
        ensureOpen();
      }
    }, {
      id: "file-browser.open_path",
      title: "Open file by path",
      description: "Type a path and open it in the file browser",
      group: "Files",
      palette: true,
      bind: "<leader>o",
      run: askPath
    }]
  }));
  return null;
}
export default Plugin.define({
  id: "opencode-file-browser",
  setup(context) {
    const offPanel = context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === ROUTE;
        },
        get children() {
          return _$createComponent(FileBrowser, {
            context: context,
            location: () => context.data.session.get(panel.sessionID)?.location ?? context.data.location.default(),
            panel: panel,
            get onClose() {
              return panel.close;
            }
          });
        }
      })
    });
    const offRoute = context.ui.router.register({
      name: ROUTE,
      render: ({
        data
      }) => _$createComponent(BrowserRoute, {
        context: context,
        data: data
      })
    });
    const offCommands = context.ui.slot({
      append: "app",
      render: () => _$createComponent(Commands, {
        context: context
      })
    });
    return () => {
      offRoute();
      offPanel();
      offCommands();
    };
  }
});