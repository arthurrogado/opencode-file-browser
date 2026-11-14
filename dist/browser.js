import { use as _$use } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { MouseButton, SyntaxStyle, TextAttributes } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { ErrorBoundary, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import path from "node:path";
import { copyFile, mkdir, readFile, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { HEAVY_CHARS, HEAVY_LINES, MAX_CHARS, MAX_LINES, OVERSIZE_BYTES, OVERSIZE_LINES, basename, clampLongLines, expandHome, filetype, formatBytes, isBinary, isMarkdown, message, parentOf } from "./lib/util.js";
import { useSettings } from "./lib/settings.js";
import { collapseTarget, isNavigate, navigateRows, upTarget } from "./lib/navigation.js";
import { searchContent } from "./lib/search.js";
import * as git from "./lib/git.js";
import { EditorView, isDirty } from "./ui/editor.js";
import { SettingsDialog } from "./ui/settings.js";
export const ROUTE = "file-browser";
const [controller, setController] = createSignal();

/**
 * Keymap layers are registered once for the plugin lifetime. The route and the
 * panel mount/unmount freely (and remount on host re-renders), so binding the
 * layers to a component instance made them disappear under heavy files.
 */
export function registerBrowserLayers(context) {
  context.keymap.layer(() => {
    const current = controller();
    return {
      priority: 105,
      enabled: () => !!current && current.enabled(),
      commands: current?.keys() ?? []
    };
  });
  context.keymap.layer(() => {
    const current = controller();
    return {
      priority: 100,
      enabled: () => !!current && current.enabled() && !current.typing(),
      commands: current?.commands() ?? []
    };
  });
  context.keymap.layer(() => {
    const current = controller();
    return {
      priority: 110,
      enabled: () => !!current && current.changesEnabled(),
      commands: current?.changes() ?? []
    };
  });
}
const iconFor = (row, theme) => {
  if (row.type === "directory") return {
    glyph: "▸",
    color: theme.text.action.secondary.base
  };
  if (row.type === "hit") return {
    glyph: "·",
    color: theme.text.muted
  };
  const name = basename(row.path);
  if (isMarkdown(name)) return {
    glyph: "◆",
    color: theme.markdown.link
  };
  const ext = name.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return {
    glyph: "◆",
    color: theme.syntax.function
  };
  if (/\.(json|jsonc|ya?ml|toml|ini)$/.test(ext)) return {
    glyph: "◆",
    color: theme.syntax.number
  };
  if (/\.(sh|bash|zsh)$/.test(ext)) return {
    glyph: "◆",
    color: theme.syntax.string
  };
  if (/\.(md|markdown|mdx)$/.test(ext)) return {
    glyph: "◆",
    color: theme.markdown.link
  };
  return {
    glyph: "·",
    color: theme.text.muted
  };
};
const CHANGE_LETTER = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "?",
  conflicted: "U"
};
export function Browser(props) {
  const context = props.context;
  const theme = context.theme;
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const settings = useSettings(context);
  const options = () => settings.value();
  const syntax = createSyntaxStyle(theme, renderer.nativeScene);
  // Destroy only when this component unmounts. renderer.idle() resolves after
  // the next idle frame, not at teardown.
  onCleanup(() => {
    void renderer.idle?.()?.then(() => syntax.destroy());
  });
  const [docs, setDocs] = createSignal([]);
  const [active, setActive] = createSignal(-1);
  const [modes, setModes] = createSignal({});
  const [previews, setPreviews] = createSignal({});
  const [focus, setFocus] = createSignal("explorer");
  const [index, setIndex] = createSignal(0);
  const [dirs, setDirs] = createSignal({});
  const [expanded, setExpanded] = createSignal([]);
  const [navRoot, setNavRoot] = createSignal("");
  const [externalChange, setExternalChange] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal();
  const [query, setQuery] = createSignal("");
  const [searchMode, setSearchMode] = createSignal(options().search);
  const [hits, setHits] = createSignal([]);
  const [hitsTruncated, setHitsTruncated] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [found, setFound] = createSignal([]);
  const [gitState, setGitState] = createSignal({
    repo: false,
    branch: "",
    changes: [],
    staged: 0,
    unstaged: 0
  });
  const [changeIndex, setChangeIndex] = createSignal(0);
  const [commitMessage, setCommitMessage] = createSignal("");
  const [composing, setComposing] = createSignal(false);
  const [inputFocus, setInputFocus] = createSignal(false);
  const [status, setStatus] = createSignal();
  const [pendingLine, setPendingLine] = createSignal(0);
  const [drag, setDrag] = createSignal({
    active: false,
    width: 0
  });
  const [splitWidth, setSplitWidth] = createSignal(0);
  const [clipboard, setClipboard] = createSignal();
  const [treeHidden, setTreeHidden] = createSignal(false);
  const positions = new Map();
  const [statusTimer, setStatusTimer] = createSignal();
  createEffect(() => {
    const value = status();
    if (!value) return;
    const previous = statusTimer();
    if (previous) clearTimeout(previous);
    setStatusTimer(setTimeout(() => setStatus(undefined), 6000));
  });
  let searchInput;
  let commitInput;
  let editorApi;

  // Tabs survive a trip to the chat: the panel unmounts when the session view
  // takes over, so the documents live in the host's in-memory store.
  const [stored, updateStored] = context.storage.memory("browser", {
    initial: {}
  });
  const restored = {
    ...stored
  };
  let persistTimer;
  createEffect(() => {
    const snapshot = {
      root: props.location().directory,
      docs: docs(),
      active: active(),
      modes: modes(),
      previews: previews(),
      navRoot: navRoot()
    };
    if (!snapshot.docs.length) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void updateStored(draft => {
        Object.assign(draft, snapshot);
      });
    }, 250);
  });
  const docked = () => props.panel !== undefined && props.panel.presentation === "panel";
  const simple = () => options().simple;
  const width = () => docked() ? props.panel?.width ?? dimensions().width : dimensions().width;
  const explorerWidth = () => {
    const custom = splitWidth();
    if (custom) return custom;
    return Math.max(18, Math.min(46, Math.floor(width() * 0.28)));
  };
  const showChanges = () => !simple() && !docked() && options().changes && gitState().repo && width() >= 130;
  const showEditor = () => !docked() || options().panelPreview;
  const surface = () => docked() ? theme.background.raised.base : theme.background.base;
  const doc = () => docs()[active()];
  const isEditing = () => {
    const current = doc();
    return current ? !!modes()[current.path] : false;
  };
  const showMarkdown = () => {
    const current = doc();
    return current ? previews()[current.path] ?? true : true;
  };

  // While the textarea owns the keyboard every global letter binding would eat
  // the user's keystrokes; only the handlers attached to the textarea itself
  // (escape, tab, ctrl+s, ctrl+w, ctrl+arrows) stay live.
  const typing = () => focus() === "editor" && isEditing() && !showMarkdown();

  // Ask the renderables themselves: the focus/blur events of the host input
  // are not reliable when a panel remounts, and a stuck flag would swallow
  // every global key (escape included).
  const inputFocused = () => !!(searchInput && !searchInput.isDestroyed && searchInput.focused) || !!(commitInput && !commitInput.isDestroyed && commitInput.focused);
  const navigate = () => isNavigate(options().tree);
  const rows = createMemo(() => {
    const name = query().trim();
    const fold = value => options().caseSensitive ? value : value.toLowerCase();
    const needle = fold(name);
    if (name && searchMode() === "name") {
      if (name.length >= 2 && found().length > 0) {
        return found().map(value => ({
          path: value,
          type: "file",
          depth: 0
        }));
      }
      return listing().filter(row => fold(row.path).includes(needle));
    }
    if (searchMode() === "content" && name.length >= 2) {
      return hits().map(hit => ({
        path: hit.path,
        type: "hit",
        depth: 1,
        line: hit.line,
        preview: hit.text
      }));
    }
    return listing();
  });
  function listing() {
    if (!navigate()) return flatten(dirs(), expanded());
    return navigateRows(navRoot(), dirs()[navRoot()] ?? []);
  }
  function flatten(cache, open, root = "", depth = 0, output = []) {
    const entries = cache[root];
    if (!entries) return output;
    for (const entry of entries) {
      output.push({
        path: entry.path,
        type: entry.type,
        depth
      });
      if (entry.type === "directory" && open.includes(entry.path)) {
        flatten(cache, open, entry.path, depth + 1, output);
      }
    }
    return output;
  }
  const currentRow = () => rows()[index()];
  function setCache(path, entries) {
    setDirs(cache => ({
      ...cache,
      [path]: entries
    }));
  }
  async function loadDirectory(target) {
    const result = await context.client.file.list({
      location: props.location(),
      path: target || undefined
    });
    const items = result.data.filter(entry => options().hidden || !basename(entry.path).startsWith(".")).map(entry => ({
      path: entry.path.replace(/\/+$/, ""),
      type: entry.type
    })).sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return basename(left.path).localeCompare(basename(right.path), undefined, {
        sensitivity: "base"
      });
    });
    setCache(target, items);
    return items;
  }
  async function enterDirectory(target) {
    setLoading(true);
    try {
      if (!dirs()[target]) await loadDirectory(target);
      setNavRoot(target);
      setIndex(0);
    } catch (cause) {
      // Keep the previous listing: a failed load must never leave an empty
      // screen that looks frozen.
      setStatus(`Could not open ${target}: ${message(cause)}`);
    } finally {
      setLoading(false);
    }
  }
  async function goUp(all = false) {
    if (!navRoot()) return false;
    await enterDirectory(upTarget(navRoot(), all));
    return true;
  }
  async function toggleDirectory(row) {
    if (expanded().includes(row.path)) {
      setExpanded(open => open.filter(value => value !== row.path && !value.startsWith(`${row.path}/`)));
      return;
    }
    setLoading(true);
    try {
      if (!dirs()[row.path]) await loadDirectory(row.path);
      setExpanded(open => [...open, row.path]);
    } catch (cause) {
      setStatus(`Could not open ${row.path}: ${message(cause)}`);
    } finally {
      setLoading(false);
    }
  }
  function collapseAll() {
    const target = collapseTarget(options().tree, navRoot());
    if (target !== null) {
      void enterDirectory(target);
      return;
    }
    setExpanded([]);
    setIndex(0);
  }
  async function refreshTree() {
    const open = expanded();
    const loaded = Object.keys(dirs()).filter(Boolean);
    setDirs({});
    try {
      await loadDirectory("");
      for (const directory of loaded) {
        await loadDirectory(directory).catch(() => undefined);
      }
      setExpanded(open);
      if (navigate() && navRoot()) await loadDirectory(navRoot()).catch(() => undefined);
    } catch (cause) {
      setError(message(cause));
    }
  }
  async function loadFile(target, external) {
    const bytes = external ? new Uint8Array(await readFile(target)) : await context.client.file.read({
      location: props.location(),
      path: target
    });
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (isBinary(data)) return {
      binary: true,
      oversize: false,
      size: data.length
    };
    let text = new TextDecoder("utf-8").decode(data);
    if (data.length > OVERSIZE_BYTES) {
      const lines = (text.match(/\n/g)?.length ?? 0) + 1;
      return {
        binary: false,
        oversize: true,
        lines,
        size: data.length
      };
    }
    let truncated = false;
    let lineCount = 0;
    let cut = -1;
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) !== 10) continue;
      lineCount++;
      if (lineCount === MAX_LINES) cut = index;
    }
    if (lineCount + 1 > OVERSIZE_LINES) {
      return {
        binary: false,
        oversize: true,
        lines: lineCount + 1,
        size: data.length
      };
    }
    if (cut >= 0) {
      text = text.slice(0, cut);
      truncated = true;
    }
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
    }
    const clamped = clampLongLines(text);
    text = clamped.text;
    truncated = truncated || clamped.clipped;
    const readOnly = data.length > HEAVY_CHARS || lineCount > HEAVY_LINES || truncated;
    return {
      binary: false,
      oversize: false,
      text,
      truncated,
      readOnly,
      size: data.length
    };
  }
  async function openDoc(target, external, line) {
    const existing = docs().findIndex(item => item.path === target && item.external === external);
    if (existing >= 0) {
      setActive(existing);
      setPendingLine(line ?? 0);
      if (line) setStatus(`line ${line}`);
      return;
    }
    try {
      const loaded = await loadFile(target, external);
      if (loaded.binary) {
        setStatus(`${basename(target)} is binary (${formatBytes(loaded.size)})`);
        return;
      }
      if (loaded.oversize) {
        const next = {
          path: target,
          external,
          text: "",
          original: "",
          type: filetype(target),
          markdown: false,
          truncated: true,
          readOnly: true,
          oversize: true,
          lines: loaded.lines
        };
        setDocs(list => [...list, next]);
        setActive(docs().length - 1);
        setModes(value => ({
          ...value,
          [target]: false
        }));
        setPreviews(value => ({
          ...value,
          [target]: false
        }));
        setFocus("editor");
        setStatus(`${basename(target)} is too large to render (${loaded.lines ?? "many"} lines, ${formatBytes(loaded.size)})`);
        return;
      }
      const {
        text,
        truncated,
        readOnly
      } = loaded;
      const next = {
        path: target,
        external,
        text,
        original: text,
        type: filetype(target),
        markdown: isMarkdown(target),
        truncated,
        readOnly
      };
      setDocs(list => [...list, next]);
      setActive(docs().length - 1);
      setModes(value => ({
        ...value,
        [target]: !next.markdown && !readOnly
      }));
      setPreviews(value => ({
        ...value,
        [target]: next.markdown
      }));
      setFocus("editor");
      setPendingLine(line ?? 0);
      if (readOnly) setStatus(`${basename(target)} is large; opened read-only (${formatBytes(loaded.size)})`);
      if (line) setStatus(`line ${line}`);
    } catch (cause) {
      setStatus(`Could not open ${basename(target)}: ${message(cause)}`);
    }
  }
  function relativeToLocation(target) {
    const relative = path.relative(props.location().directory, target);
    if (!relative) return "";
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return relative;
  }
  async function openByPath(input) {
    const value = input.trim();
    if (!value) return;
    const base = props.location().directory;
    const target = path.resolve(base, expandHome(value));
    const relative = relativeToLocation(target);
    const info = await stat(target).catch(() => undefined);
    if (info?.isDirectory()) {
      if (relative === undefined) {
        setStatus("That directory is outside the project.");
        return;
      }
      setSearchMode("name");
      setQuery("");
      await toggleDirectory({
        path: relative,
        type: "directory",
        depth: 0
      });
      return;
    }
    if (!info) {
      setStatus(`Not found: ${target}`);
      return;
    }
    await openDoc(relative ?? target, relative === undefined);
  }
  async function openDiff(change) {
    const path = `diff:${change.path}`;
    const existing = docs().findIndex(item => item.path === path);
    if (existing >= 0) {
      setActive(existing);
      setFocus("editor");
      return;
    }
    try {
      let text = "";
      if (change.status === "untracked") {
        const content = await readFile(absolute(change.path), "utf8");
        const lines = content.split("\n");
        text = `--- /dev/null\n+++ b/${change.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join("\n")}`;
      } else {
        const args = change.staged ? ["diff", "--cached", "--", change.path] : ["diff", "--", change.path];
        const result = await git.git(props.location().directory, args);
        text = result.stdout;
      }
      if (!text.trim()) text = "No textual changes.";
      const next = {
        path,
        external: false,
        text,
        original: text,
        type: filetype(change.path),
        markdown: false,
        truncated: false,
        readOnly: true,
        diff: true,
        rawPath: change.path
      };
      setDocs(list => [...list, next]);
      setActive(docs().length - 1);
      setModes(value => ({
        ...value,
        [path]: false
      }));
      setPreviews(value => ({
        ...value,
        [path]: false
      }));
      setFocus("editor");
    } catch (cause) {
      setStatus(`Could not diff ${change.path}: ${message(cause)}`);
    }
  }
  async function openRow(row) {
    if (row.parent) {
      await goUp();
      return;
    }
    if (row.type === "directory") {
      if (navigate()) await enterDirectory(row.path);else await toggleDirectory(row);
      return;
    }
    if (row.type === "hit") {
      await openDoc(row.path, false, row.line);
      return;
    }
    if (row.path.endsWith("/")) await toggleDirectory(row);else await openDoc(row.path, false);
  }

  /**
   * Take the tree to where the file lives: expand the ancestors (expand mode)
   * or enter the parent folder (navigate mode) and select the row. Diff tabs
   * point at the file they came from; external files have no tree entry.
   */
  async function revealDoc(target) {
    const file = target.rawPath ?? target.path;
    if (target.external || path.isAbsolute(file) || file.startsWith("..")) {
      setStatus(`${basename(file)} is outside the project folder, so it has no tree entry`);
      return;
    }
    setTreeHidden(false);
    setQuery("");
    setFound([]);
    setHits([]);
    setInputFocus(false);
    setLoading(true);
    try {
      // Dotfiles are filtered out at load time, so a reveal has to un-hide
      // them and reload before the row can exist.
      if (basename(file).startsWith(".") && !options().hidden) {
        await settings.update(draft => {
          draft.hidden = true;
        });
        await refreshTree();
      }
      const parent = parentOf(file);
      if (navigate()) {
        if (navRoot() !== parent || !dirs()[parent]) await enterDirectory(parent);
      } else {
        if (!dirs()[""]) await loadDirectory("");
        const open = new Set(expanded());
        let prefix = "";
        for (const segment of parent ? parent.split("/") : []) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          if (!dirs()[prefix]) await loadDirectory(prefix);
          open.add(prefix);
        }
        setExpanded([...open]);
      }
      const at = listing().findIndex(row => row.path === file);
      if (at < 0) {
        setStatus(`Could not find ${file} in the tree`);
        return;
      }
      setFocus("explorer");
      setIndex(at);
      setStatus(`Revealed ${file}`);
    } catch (cause) {
      setStatus(`Could not reveal ${file}: ${message(cause)}`);
    } finally {
      setLoading(false);
    }
  }
  function closeDoc(at) {
    const target = docs()[at];
    if (!target) return;
    const drop = () => {
      const next = docs().filter((_, position) => position !== at);
      const nextActive = Math.max(0, Math.min(next.length - 1, active() >= at ? active() - 1 : active()));
      setDocs(next);
      setActive(nextActive);
    };
    if (!isDirty(target)) {
      drop();
      return;
    }
    if (!options().confirmDiscard) {
      drop();
      return;
    }
    void context.ui.dialog.select({
      title: `Close ${basename(target.path)}?`,
      options: [{
        title: "Save and close",
        value: "save"
      }, {
        title: "Close without saving",
        value: "discard"
      }, {
        title: "Cancel",
        value: "cancel"
      }]
    }).then(async choice => {
      if (choice === "discard") drop();
      if (choice === "save") {
        await save(target);
        drop();
      }
    });
  }
  function updateDoc(target, text) {
    setDocs(list => list.map(item => item.path === target.path && item.external === target.external ? {
      ...item,
      text
    } : item));
  }
  async function save(target = doc()) {
    if (!target) return;
    if (target.readOnly) {
      setStatus("This file is read-only here; open it in an external editor.");
      return;
    }
    const current = docs().find(item => item.path === target.path && item.external === target.external);
    if (!current) return;
    try {
      const disk = await (current.external ? readFile(current.path).then(bytes => new TextDecoder("utf-8").decode(bytes)) : context.client.file.read({
        location: props.location(),
        path: current.path
      }).then(bytes => new TextDecoder("utf-8").decode(bytes)));
      if (disk !== current.original) {
        const overwrite = await context.ui.dialog.confirm({
          title: "File changed on disk",
          message: `${basename(current.path)} changed outside the editor. Overwrite it with your version?`,
          label: {
            confirm: "Overwrite",
            cancel: "Keep disk"
          }
        });
        if (!overwrite) {
          setStatus("Save cancelled; reload the file to see the disk version.");
          return;
        }
      }
      const payload = new TextEncoder().encode(current.text);
      if (current.external) await writeFile(current.path, payload);else await context.client.experimental.file.write({
        location: props.location(),
        path: current.path,
        payload
      });
      setDocs(list => list.map(item => item.path === current.path && item.external === current.external ? {
        ...item,
        original: current.text
      } : item));
      setStatus(`Saved ${basename(current.path)}`);
      void refreshGit();
    } catch (cause) {
      setStatus(`Save failed: ${message(cause)}`);
      context.ui.toast.show({
        variant: "error",
        message: `Save failed: ${message(cause)}`
      });
    }
  }
  async function refreshGit() {
    if (simple()) return;
    try {
      setGitState(await git.status(props.location().directory));
    } catch (cause) {
      setGitState({
        repo: false,
        branch: "",
        changes: [],
        staged: 0,
        unstaged: 0,
        error: message(cause)
      });
    }
  }
  async function runGitAction(action) {
    const root = props.location().directory;
    const change = gitState().changes[changeIndex()];
    try {
      if (action === "stage") await git.stage(root, change?.path);
      if (action === "unstage") await git.unstage(root, change?.path);
      if (action === "discard" && change) {
        if (options().confirmDiscard) {
          const ok = await context.ui.dialog.confirm({
            title: "Discard changes",
            message: `Throw away local changes in ${change.path}? This cannot be undone.`,
            label: {
              confirm: "Discard",
              cancel: "Cancel"
            }
          });
          if (!ok) return;
        }
        await git.discard(root, change);
      }
      if (action === "commit") {
        const text = commitMessage().trim();
        if (!text) {
          setStatus("Write a commit message first.");
          return;
        }
        const result = await git.commit(root, text);
        if (!result.ok) {
          setStatus(result.stderr.trim() || result.stdout.trim() || "Commit failed");
          return;
        }
        setCommitMessage("");
        setStatus("Committed");
        context.ui.toast.show({
          variant: "success",
          message: "Commit created"
        });
      }
      if (action === "pull" || action === "push") {
        const result = action === "pull" ? await git.pull(root) : await git.push(root);
        const last = `${result.stdout}${result.stderr}`.trim().split("\n").filter(Boolean).pop() ?? "";
        setStatus(last || `${action} finished`);
        context.ui.toast.show({
          variant: result.ok ? "success" : "error",
          message: last || `${action} finished`
        });
      }
      await refreshGit();
    } catch (cause) {
      setStatus(`${action} failed: ${message(cause)}`);
    }
  }
  async function showHistory() {
    const lines = await git.log(props.location().directory);
    await context.ui.dialog.alert({
      title: "Recent commits",
      message: lines.join("\n") || "No commits"
    });
  }
  async function showBranches() {
    const list = await git.branches(props.location().directory);
    await context.ui.dialog.alert({
      title: "Branches",
      message: list.join("\n") || "No branches"
    });
  }
  function toggleEdit() {
    const current = doc();
    if (!current) return;
    if (current.diff) {
      if (current.rawPath) void openDoc(current.rawPath, false);
      return;
    }
    if (current.readOnly) {
      setStatus("Large file: read-only preview.");
      return;
    }
    if (isEditing()) {
      setModes(value => ({
        ...value,
        [current.path]: false
      }));
      if (current.markdown) setPreviews(value => ({
        ...value,
        [current.path]: true
      }));
      return;
    }
    setModes(value => ({
      ...value,
      [current.path]: true
    }));
    setPreviews(value => ({
      ...value,
      [current.path]: false
    }));
    setFocus("editor");
  }
  function toggleMarkdown() {
    const current = doc();
    if (!current?.markdown) return;
    setModes(value => ({
      ...value,
      [current.path]: false
    }));
    setPreviews(value => ({
      ...value,
      [current.path]: !(value[current.path] ?? true)
    }));
  }
  function moveSelection(delta) {
    if (focus() === "explorer") {
      const total = rows().length;
      if (!total) return;
      setIndex(value => Math.max(0, Math.min(total - 1, value + delta)));
      return;
    }
    if (focus() === "changes") {
      const total = gitState().changes.length;
      if (!total) return;
      setChangeIndex(value => Math.max(0, Math.min(total - 1, value + delta)));
      return;
    }
    if (isEditing() && !showMarkdown()) return;
  }
  function pageSelection(direction) {
    const size = Math.max(1, Math.floor(dimensions().height / 2));
    moveSelection(direction * size);
  }
  async function doSearch(value) {
    setQuery(value);
    setIndex(0);
    if (searchMode() === "name") {
      if (value.trim().length < 2) {
        setFound([]);
        return;
      }
      try {
        const result = await context.client.file.find({
          location: props.location(),
          query: value.trim(),
          limit: 200
        });
        setFound(result.data.filter(entry => entry.type === "file").filter(entry => !options().caseSensitive || entry.path.includes(value.trim())).map(entry => entry.path));
      } catch {
        setFound([]);
      }
      return;
    }
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const result = await searchContent(props.location().directory, value, options().caseSensitive);
      if (value !== query()) return;
      setHits([...result.hits]);
      setHitsTruncated(result.truncated);
      if (result.error) setStatus(result.error);
    } finally {
      setSearching(false);
    }
  }
  let searchTimer;
  function scheduleSearch(value) {
    setQuery(value);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void doSearch(value), 220);
  }
  function toggleSearchMode() {
    setSearchMode(value => value === "name" ? "content" : "name");
    setHits([]);
    setFound([]);
    setQuery("");
    setIndex(0);
    focusSearch();
  }
  function focusSearch() {
    setFocus("explorer");
    setInputFocus(true);
    if (searchInput && !searchInput.isDestroyed) {
      searchInput.focus();
      return;
    }
    setTimeout(() => {
      try {
        searchInput?.focus();
      } catch {}
    }, 30);
  }
  function focusCommit() {
    setComposing(true);
    setTimeout(() => {
      try {
        commitInput?.focus();
      } catch {}
    }, 30);
  }
  function openSettings() {
    context.ui.dialog.set({
      size: "xlarge"
    });
    context.ui.dialog.show(() => _$createComponent(SettingsDialog, {
      context: context,
      get value() {
        return settings.value();
      },
      onChange: mutation => void settings.update(mutation),
      onClose: () => context.ui.dialog.clear()
    }), () => {});
  }
  function showHelp() {
    context.ui.dialog.set({
      size: "large"
    });
    context.ui.dialog.show(() => (() => {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("text"),
        _el$4 = _$createElement("scrollbox"),
        _el$5 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$4);
      _$insertNode(_el$, _el$5);
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "padding", 1);
      _$setProp(_el$, "gap", 0);
      _$setProp(_el$, "width", 78);
      _$insertNode(_el$2, _$createTextNode(`Keyboard shortcuts`));
      _$setProp(_el$4, "height", 22);
      _$setProp(_el$4, "flexGrow", 1);
      _$setProp(_el$4, "verticalScrollbarOptions", {
        visible: true
      });
      _$insert(_el$4, _$createComponent(For, {
        get each() {
          return helpRows();
        },
        children: row => (() => {
          var _el$7 = _$createElement("box"),
            _el$8 = _$createElement("box"),
            _el$9 = _$createElement("text"),
            _el$0 = _$createElement("text");
          _$insertNode(_el$7, _el$8);
          _$insertNode(_el$7, _el$0);
          _$setProp(_el$7, "flexDirection", "row");
          _$setProp(_el$7, "height", 1);
          _$insertNode(_el$8, _el$9);
          _$setProp(_el$8, "width", 18);
          _$setProp(_el$8, "flexShrink", 0);
          _$setProp(_el$9, "wrapMode", "none");
          _$insert(_el$9, () => row.keys);
          _$setProp(_el$0, "wrapMode", "none");
          _$setProp(_el$0, "truncate", true);
          _$insert(_el$0, () => row.title);
          _$effect(_p$ => {
            var _v$4 = theme.text.action.primary.selected,
              _v$5 = theme.text.base;
            _v$4 !== _p$.e && (_p$.e = _$setProp(_el$9, "fg", _v$4, _p$.e));
            _v$5 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$5, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$7;
        })()
      }));
      _$insertNode(_el$5, _$createTextNode(`↑↓ scroll · esc close · every command is also in ctrl+p`));
      _$setProp(_el$5, "wrapMode", "none");
      _$effect(_p$ => {
        var _v$ = theme.text.base,
          _v$2 = TextAttributes.BOLD,
          _v$3 = theme.text.muted;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "attributes", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$5, "fg", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$;
    })());
  }
  const helpRows = () => [{
    keys: "^X F",
    title: "Open or close the file browser"
  }, {
    keys: "^X O",
    title: "Open a file by path"
  }, {
    keys: "^P",
    title: "Command palette (all actions live there)"
  }, {
    keys: "↑ ↓ / j k",
    title: "Move in the list"
  }, {
    keys: "→ / enter",
    title: "Open file or expand folder"
  }, {
    keys: "← / shift+enter",
    title: "Collapse folder"
  }, {
    keys: "tab",
    title: "Cycle explorer / editor / changes"
  }, {
    keys: "^F",
    title: "Focus search"
  }, {
    keys: "^E",
    title: "Switch name / content search"
  }, {
    keys: "^S",
    title: "Save the current file"
  }, {
    keys: "^W",
    title: "Close the current tab"
  }, {
    keys: "^← ^→",
    title: "Previous / next tab"
  }, {
    keys: "e",
    title: "Toggle preview / editor"
  }, {
    keys: "m",
    title: "Toggle rendered Markdown"
  }, {
    keys: "ctrl+g",
    title: "Focus the changes panel"
  }, {
    keys: "F1",
    title: "This help"
  }, {
    keys: "F2",
    title: "Preferences"
  }, {
    keys: "F3",
    title: "Focus the changes panel"
  }, {
    keys: "F4",
    title: "Toggle preview / editor"
  }, {
    keys: "F6",
    title: "Show/hide the file tree"
  }, {
    keys: "f",
    title: "Toggle fullscreen (docked panel)"
  }, {
    keys: "r",
    title: "Reload tree, file and git status"
  }, {
    keys: "h",
    title: "Toggle hidden files"
  }];
  const absolute = relative => path.join(props.location().directory, relative);
  async function refreshDirectory(relative) {
    await loadDirectory(relative).catch(() => undefined);
    if (!navigate() && relative && !expanded().includes(relative)) setExpanded(open => [...open, relative]);
  }
  function dropDocs(predicate) {
    const next = docs().filter(item => !predicate(item));
    setDocs(next);
    setActive(value => Math.max(0, Math.min(next.length - 1, value)));
  }
  async function closeMany(mode) {
    const keep = mode === "others" ? docs()[active()] : undefined;
    const targets = docs().filter(item => item !== keep);
    if (!targets.length) return;
    const dirty = targets.filter(isDirty);
    if (dirty.length && options().confirmDiscard) {
      const ok = await context.ui.dialog.confirm({
        title: "Close tabs",
        message: `${dirty.length} unsaved ${dirty.length === 1 ? "file" : "files"} will lose changes.`,
        label: {
          confirm: "Close",
          cancel: "Cancel"
        }
      });
      if (!ok) return;
    }
    setDocs(keep ? [keep] : []);
    setActive(keep ? 0 : -1);
  }
  async function pickDirectory(start, title) {
    const items = dirs()[start] ?? (await loadDirectory(start).catch(() => []));
    const options = [{
      title: "✓ Use this folder",
      value: "__here"
    }, ...(start ? [{
      title: "↰ .. (up)",
      value: "__up"
    }] : []), ...items.filter(entry => entry.type === "directory").map(entry => ({
      title: `▸ ${basename(entry.path)}/`,
      value: entry.path
    }))];
    const choice = await context.ui.dialog.select({
      title: `${title} · ${start || "/"}`,
      options
    });
    if (!choice) return undefined;
    if (choice === "__here") return start;
    if (choice === "__up") return pickDirectory(parentOf(start), title);
    return pickDirectory(choice, title);
  }
  async function moveEntry(row, target) {
    const destination = target ? `${target}/${basename(row.path)}` : basename(row.path);
    if (destination === row.path) return;
    try {
      if (existsSync(absolute(destination))) {
        const ok = await context.ui.dialog.confirm({
          title: "Overwrite",
          message: `${destination} already exists. Replace it?`,
          label: {
            confirm: "Replace",
            cancel: "Cancel"
          }
        });
        if (!ok) return;
        await rm(absolute(destination), {
          recursive: true,
          force: true
        });
      }
      await renameFile(absolute(row.path), absolute(destination));
      dropDocs(item => item.path === row.path || item.path.startsWith(`${row.path}/`) || item.rawPath === row.path);
      await refreshDirectory(parentOf(row.path));
      await refreshDirectory(target);
      setStatus(`Moved to ${destination}`);
    } catch (cause) {
      setStatus(`Move failed: ${message(cause)}`);
    }
  }
  async function pasteInto(target) {
    const source = clipboard();
    if (!source) return;
    const destination = target ? `${target}/${basename(source)}` : basename(source);
    if (destination === source) return;
    try {
      if (existsSync(absolute(destination))) {
        const ok = await context.ui.dialog.confirm({
          title: "Overwrite",
          message: `${destination} already exists. Replace it?`,
          label: {
            confirm: "Replace",
            cancel: "Cancel"
          }
        });
        if (!ok) return;
        await rm(absolute(destination), {
          recursive: true,
          force: true
        });
      }
      await copyFile(absolute(source), absolute(destination));
      await refreshDirectory(target);
      setStatus(`Pasted into ${target || "the project root"}`);
    } catch (cause) {
      setStatus(`Paste failed: ${message(cause)}`);
    }
  }
  async function openContext(kind, target, baseOverride) {
    const row = kind === "tree" ? target : undefined;
    const tabDoc = kind === "tab" ? target ?? doc() : doc();
    const base = baseOverride ?? (row ? row.type === "directory" ? row.path : parentOf(row.path) : navigate() ? navRoot() : "");
    const targetDoc = row && row.type !== "directory" ? docs().find(item => item.path === row.path) : tabDoc;
    const pasteTarget = !row || row.type === "directory";
    const treeOptions = [{
      title: "New file…",
      value: "new-file"
    }, {
      title: "New folder…",
      value: "new-folder"
    }, ...(row && row.type !== "hit" && !row.parent ? [{
      title: "Copy",
      value: "copy"
    }, {
      title: "Move to…",
      value: "move"
    }] : []), ...(clipboard() && pasteTarget ? [{
      title: `Paste ${basename(clipboard())} here`,
      value: "paste"
    }] : []), {
      title: "Rename…",
      value: "rename",
      disabled: !row || row.parent
    }, {
      title: "Delete…",
      value: "delete",
      disabled: !row || row.parent
    }, {
      title: `Close tab${targetDoc ? ` (${basename(targetDoc.path)})` : ""}`,
      value: "close-tab",
      disabled: !targetDoc
    }, {
      title: "Close other tabs",
      value: "close-others"
    }, {
      title: "Close all tabs",
      value: "close-all"
    }];
    const tabOptions = [{
      title: "Reveal in the file tree",
      value: "reveal"
    }, {
      title: `Close (${tabDoc ? basename(tabDoc.path) : "tab"})`,
      value: "close-tab"
    }, {
      title: "Close other tabs",
      value: "close-others"
    }, {
      title: "Close all tabs",
      value: "close-all"
    }];
    const choice = await context.ui.dialog.select({
      title: kind === "tree" ? `Actions · ${row ? basename(row.path) : "project"}` : "Tab actions",
      options: kind === "tree" ? treeOptions : tabOptions
    });
    if (!choice) return;
    if (choice === "reveal") {
      if (tabDoc) await revealDoc(tabDoc);
      return;
    }
    if (choice === "close-tab") {
      const at = targetDoc ? docs().findIndex(item => item.path === targetDoc.path && item.external === targetDoc.external) : active();
      if (at >= 0) closeDoc(at);
      return;
    }
    if (choice === "close-others") return closeMany("others");
    if (choice === "close-all") return closeMany("all");
    if (choice === "copy" && row) {
      setClipboard(row.path);
      setStatus(`Copied ${row.path} — paste it from the target folder`);
      return;
    }
    if (choice === "paste") {
      await pasteInto(base);
      return;
    }
    if (choice === "move" && row) {
      const target = await pickDirectory(parentOf(row.path), `Move ${basename(row.path)}`);
      if (target === undefined) return;
      await moveEntry(row, target);
      return;
    }
    if (choice === "new-file" || choice === "new-folder") {
      const name = await context.ui.dialog.prompt({
        title: choice === "new-file" ? "New file" : "New folder",
        description: base ? `inside ${base}/` : "inside the project root",
        placeholder: choice === "new-file" ? "notes.md" : "folder"
      });
      const clean = name?.trim().replace(/^\.?\//, "");
      if (!clean) return;
      const relative = base ? `${base}/${clean}` : clean;
      try {
        if (choice === "new-file") await writeFile(absolute(relative), "");else await mkdir(absolute(relative), {
          recursive: true
        });
        await refreshDirectory(base);
        setStatus(`Created ${relative}`);
        if (choice === "new-file") await openDoc(relative, false);
      } catch (cause) {
        setStatus(`Could not create ${relative}: ${message(cause)}`);
      }
      return;
    }
    if (!row) return;
    if (choice === "rename") {
      const name = await context.ui.dialog.prompt({
        title: "Rename",
        value: basename(row.path),
        description: row.path
      });
      const clean = name?.trim();
      if (!clean || clean === basename(row.path)) return;
      const next = parentOf(row.path) ? `${parentOf(row.path)}/${clean}` : clean;
      try {
        await renameFile(absolute(row.path), absolute(next));
        dropDocs(item => item.path === row.path || item.path.startsWith(`${row.path}/`));
        await refreshDirectory(parentOf(row.path));
        setStatus(`Renamed to ${next}`);
      } catch (cause) {
        setStatus(`Rename failed: ${message(cause)}`);
      }
      return;
    }
    if (choice === "delete") {
      const ok = await context.ui.dialog.confirm({
        title: "Delete",
        message: `Delete ${row.path}${row.type === "directory" ? " and everything inside it" : ""}?`,
        label: {
          confirm: "Delete",
          cancel: "Cancel"
        }
      });
      if (!ok) return;
      try {
        await rm(absolute(row.path), {
          recursive: true,
          force: true
        });
        dropDocs(item => item.path === row.path || item.path.startsWith(`${row.path}/`) || item.rawPath === row.path);
        await refreshDirectory(parentOf(row.path));
        setStatus(`Deleted ${row.path}`);
      } catch (cause) {
        setStatus(`Delete failed: ${message(cause)}`);
      }
    }
  }
  const commands = [{
    id: "file-browser.escape",
    title: "Leave editor / clear search / close",
    group: "Files",
    bind: "escape",
    enabled: () => !inputFocused() && !composing(),
    run: () => {
      if (focus() !== "explorer") {
        setFocus("explorer");
        return;
      }
      if (query().trim().length > 0) {
        scheduleSearch("");
        setHits([]);
        setFound([]);
        setIndex(0);
        return;
      }
      void requestClose();
    }
  }, {
    id: "file-browser.close",
    title: "Close file browser",
    group: "Files",
    bind: "q",
    enabled: () => !inputFocused() && !composing(),
    run: () => void requestClose()
  }, {
    id: "file-browser.down",
    title: "Next item",
    group: "Files",
    bind: "down,j",
    enabled: () => !inputFocused() && !composing(),
    run: () => moveSelection(1)
  }, {
    id: "file-browser.up",
    title: "Previous item",
    group: "Files",
    bind: "up,k",
    enabled: () => !inputFocused() && !composing(),
    run: () => moveSelection(-1)
  }, {
    id: "file-browser.select",
    title: "Open selected item",
    group: "Files",
    bind: "return",
    enabled: () => !inputFocused() && !composing(),
    run: () => {
      const row = currentRow();
      if (row && focus() === "explorer") void openRow(row);
    }
  }, {
    id: "file-browser.select.space",
    title: "Open selected item",
    group: "Files",
    bind: "space",
    enabled: () => !inputFocused() && !composing() && focus() === "explorer",
    run: () => {
      const row = currentRow();
      if (row) void openRow(row);
    }
  }, {
    id: "file-browser.parent",
    title: "Collapse folder / go up",
    group: "Files",
    bind: "left,backspace",
    enabled: () => !inputFocused() && !composing(),
    run: () => {
      if (navigate()) {
        if (navRoot()) void goUp();
        return;
      }
      const row = currentRow();
      if (row?.type === "directory" && expanded().includes(row.path)) void toggleDirectory(row);
    }
  }, {
    id: "file-browser.expand",
    title: "Expand folder",
    group: "Files",
    bind: "right",
    enabled: () => !inputFocused() && !composing(),
    run: () => {
      const row = currentRow();
      if (row?.type === "directory" && !expanded().includes(row.path)) void toggleDirectory(row);
    }
  }, {
    id: "file-browser.collapse",
    title: "Collapse folder tree",
    group: "Files",
    bind: "shift+enter",
    enabled: () => !inputFocused() && !composing(),
    run: collapseAll
  }, {
    id: "file-browser.page_down",
    title: "Page down",
    group: "Files",
    bind: "pagedown",
    enabled: () => !inputFocused() && !composing(),
    run: () => pageSelection(1)
  }, {
    id: "file-browser.page_up",
    title: "Page up",
    group: "Files",
    bind: "pageup",
    enabled: () => !inputFocused() && !composing(),
    run: () => pageSelection(-1)
  }, {
    id: "file-browser.first",
    title: "Go to start",
    group: "Files",
    bind: "home",
    enabled: () => !inputFocused() && !composing(),
    run: () => setIndex(0)
  }, {
    id: "file-browser.last",
    title: "Go to end",
    group: "Files",
    bind: "end",
    enabled: () => !inputFocused() && !composing(),
    run: () => setIndex(Math.max(0, rows().length - 1))
  }, {
    id: "file-browser.focus",
    title: "Cycle panes",
    group: "Files",
    bind: "tab",
    enabled: () => !inputFocused() && !composing(),
    run: cycleFocus
  }, {
    id: "file-browser.search",
    title: "Search files",
    group: "Files",
    bind: "ctrl+f,/",
    enabled: () => !composing(),
    run: focusSearch
  }, {
    id: "file-browser.search.mode",
    title: "Toggle name/content search",
    group: "Files",
    bind: "ctrl+e",
    enabled: () => !composing(),
    run: toggleSearchMode
  }, {
    id: "file-browser.save",
    title: "Save file",
    group: "Files",
    bind: "ctrl+s",
    enabled: () => !composing() && !!doc(),
    run: () => void save()
  }, {
    id: "file-browser.tab.close",
    title: "Close tab",
    group: "Files",
    bind: "ctrl+w",
    enabled: () => !inputFocused() && !composing(),
    run: () => closeDoc(active())
  }, {
    id: "file-browser.tab.next",
    title: "Next tab",
    group: "Files",
    bind: "ctrl+pagedown,ctrl+right",
    enabled: () => !inputFocused() && !composing(),
    run: () => setActive(value => Math.min(docs().length - 1, value + 1))
  }, {
    id: "file-browser.tab.prev",
    title: "Previous tab",
    group: "Files",
    bind: "ctrl+pageup,ctrl+left",
    enabled: () => !inputFocused() && !composing(),
    run: () => setActive(value => Math.max(0, value - 1))
  }, {
    id: "file-browser.edit",
    title: "Toggle preview/editor",
    group: "Files",
    bind: "e",
    enabled: () => !inputFocused() && !composing(),
    run: toggleEdit
  }, {
    id: "file-browser.markdown",
    title: "Toggle Markdown/source",
    group: "Files",
    bind: "m",
    enabled: () => !inputFocused() && !composing(),
    run: toggleMarkdown
  }, {
    id: "file-browser.reload",
    title: "Reload",
    group: "Files",
    bind: "r",
    enabled: () => !inputFocused() && !composing(),
    run: () => void refresh()
  }, {
    id: "file-browser.hidden",
    title: "Toggle hidden files",
    group: "Files",
    bind: "h",
    enabled: () => !inputFocused() && !composing(),
    run: () => void settings.update(draft => {
      draft.hidden = !draft.hidden;
    }).then(refreshTree)
  }, {
    id: "file-browser.tree",
    title: "Show/hide the file tree",
    group: "Files",
    bind: "b",
    enabled: () => !inputFocused() && !composing() && focus() !== "changes",
    run: () => {
      setTreeHidden(value => !value);
      if (treeHidden() && focus() === "explorer") setFocus("editor");
    }
  }, {
    id: "file-browser.path",
    title: "Open file by path",
    group: "Files",
    bind: "o",
    enabled: () => !inputFocused() && !composing(),
    run: () => void promptPath()
  }, {
    id: "file-browser.fullscreen",
    title: "Toggle fullscreen",
    group: "Files",
    bind: "f",
    enabled: () => !inputFocused() && !composing(),
    run: toggleFullscreen
  }, {
    id: "file-browser.changes.focus",
    title: "Focus changes",
    group: "Git",
    bind: "ctrl+g",
    enabled: () => !inputFocused() && !composing() && showChanges(),
    run: () => {
      setFocus("changes");
      void refreshGit();
    }
  }];
  const changesCommands = [{
    id: "file-browser.git.open",
    title: "Open the diff for this change",
    group: "Git",
    bind: "return,space",
    enabled: () => !composing() && focus() === "changes",
    run: () => {
      const change = gitState().changes[changeIndex()];
      if (change) void openDiff(change);
    }
  }, {
    id: "file-browser.git.stage",
    title: "Stage change",
    group: "Git",
    bind: "a",
    enabled: () => !composing() && focus() === "changes",
    run: () => void runGitAction("stage")
  }, {
    id: "file-browser.git.stage_all",
    title: "Stage all changes",
    group: "Git",
    bind: "shift+a",
    enabled: () => !composing() && focus() === "changes",
    run: () => void git.stage(props.location().directory).then(refreshGit)
  }, {
    id: "file-browser.git.unstage",
    title: "Unstage change",
    group: "Git",
    bind: "u",
    enabled: () => !composing() && focus() === "changes",
    run: () => void runGitAction("unstage")
  }, {
    id: "file-browser.git.discard",
    title: "Discard change",
    group: "Git",
    bind: "d",
    enabled: () => !composing() && focus() === "changes",
    run: () => void runGitAction("discard")
  }, {
    id: "file-browser.git.commit",
    title: "Commit staged changes",
    group: "Git",
    bind: "c",
    enabled: () => !composing() && focus() === "changes",
    run: focusCommit
  }, {
    id: "file-browser.git.pull",
    title: "Pull",
    group: "Git",
    bind: "l",
    enabled: () => !composing() && focus() === "changes",
    run: () => void runGitAction("pull")
  }, {
    id: "file-browser.git.push",
    title: "Push",
    group: "Git",
    bind: "p",
    enabled: () => !composing() && focus() === "changes",
    run: () => void runGitAction("push")
  }, {
    id: "file-browser.git.branches",
    title: "Branches",
    group: "Git",
    bind: "b",
    enabled: () => !composing() && focus() === "changes",
    run: () => void showBranches()
  }, {
    id: "file-browser.git.history",
    title: "History",
    group: "Git",
    bind: "g",
    enabled: () => !composing() && focus() === "changes",
    run: () => void showHistory()
  }, {
    id: "file-browser.git.refresh",
    title: "Refresh git status",
    group: "Git",
    bind: "shift+r",
    enabled: () => !composing() && focus() === "changes",
    run: () => void refreshGit()
  }];
  const keyCommands = [{
    id: "file-browser.keys.help",
    title: "Keyboard shortcuts",
    group: "Files",
    bind: "f1",
    run: showHelp
  }, {
    id: "file-browser.keys.settings",
    title: "Preferences",
    group: "Files",
    bind: "f2",
    run: openSettings
  }, {
    id: "file-browser.keys.changes",
    title: "Focus changes",
    group: "Git",
    bind: "f3",
    enabled: () => showChanges(),
    run: () => {
      setFocus("changes");
      void refreshGit();
    }
  }, {
    id: "file-browser.keys.edit",
    title: "Toggle preview/editor",
    group: "Files",
    bind: "f4",
    run: toggleEdit
  }, {
    id: "file-browser.keys.tree",
    title: "Show/hide the file tree",
    group: "Files",
    bind: "f6",
    run: () => {
      setTreeHidden(value => !value);
      if (treeHidden() && focus() === "explorer") setFocus("editor");
    }
  }, {
    id: "file-browser.keys.explorer",
    title: "Focus the explorer",
    group: "Files",
    bind: "shift+tab",
    enabled: () => !composing(),
    run: () => setFocus("explorer")
  }, {
    id: "file-browser.keys.actions",
    title: "Item actions (new, rename, delete, close tabs)",
    group: "Files",
    bind: "f10",
    run: () => {
      if (focus() === "changes") return;
      if (focus() === "editor" && doc()) void openContext("tab", doc());else void openContext("tree", currentRow());
    }
  }, {
    id: "file-browser.keys.refresh",
    title: "Refresh",
    group: "Files",
    bind: "f5",
    run: () => void refresh()
  }, {
    id: "file-browser.keys.changes2",
    title: "Focus changes",
    group: "Git",
    bind: "ctrl+g",
    enabled: () => showChanges(),
    run: () => {
      setFocus("changes");
      void refreshGit();
    }
  }, {
    id: "file-browser.keys.newline",
    title: "Insert a new line in the editor",
    group: "Files",
    bind: "return,shift+return",
    enabled: () => typing(),
    run: () => editorApi?.newline()
  }];
  const instance = {
    commands: () => commands,
    changes: () => changesCommands,
    keys: () => keyCommands,
    enabled: () => props.panel ? props.panel.focused : true,
    changesEnabled: () => (props.panel ? props.panel.focused : true) && !composing() && focus() === "changes" && !typing(),
    typing: () => typing()
  };
  setController(instance);
  onCleanup(() => {
    if (controller() === instance) setController(undefined);
  });
  async function promptPath() {
    const value = await context.ui.dialog.prompt({
      title: "Open file by path",
      description: "Absolute path, or relative to the project. ~ points to your home.",
      placeholder: "/path/to/file or ../notes.md"
    });
    if (value) await openByPath(value);
  }
  function toggleFullscreen() {
    const panel = props.panel;
    if (!panel) return;
    panel.toggleFullscreen();
  }
  function cycleFocus() {
    setFocus(value => value === "explorer" ? showEditor() ? "editor" : "explorer" : value === "editor" ? showChanges() ? "changes" : "explorer" : "explorer");
  }
  function editorKey(event) {
    const key = String(event.name ?? event.key ?? "").toLowerCase();
    const ctrl = !!(event.ctrl || event.meta);
    if (key === "escape") {
      setFocus("explorer");
      return true;
    }
    if (key === "tab") {
      cycleFocus();
      return true;
    }
    if (ctrl && key === "s") {
      void save();
      return true;
    }
    if (ctrl && key === "w") {
      closeDoc(active());
      return true;
    }
    if (ctrl && key === "left") {
      setActive(value => Math.max(0, value - 1));
      return true;
    }
    if (ctrl && key === "right") {
      setActive(value => Math.min(docs().length - 1, value + 1));
      return true;
    }
    return false;
  }
  async function refresh() {
    const current = doc();
    if (current && isDirty(current)) {
      if (!externalChange()) {
        setStatus("Save or discard your edits before reloading.");
        await refreshGit();
        return;
      }
      const ok = await context.ui.dialog.confirm({
        title: "Reload from disk",
        message: "Your unsaved edits will be discarded.",
        label: {
          confirm: "Reload",
          cancel: "Cancel"
        }
      });
      if (!ok) return;
    }
    setExternalChange(false);
    await refreshTree();
    if (current) {
      try {
        const loaded = await loadFile(current.path, current.external);
        if (!loaded.binary && !loaded.oversize) {
          setDocs(list => list.map(item => item.path === current.path && item.external === current.external ? {
            ...item,
            text: loaded.text,
            original: loaded.text,
            truncated: loaded.truncated,
            readOnly: loaded.readOnly
          } : item));
        }
      } catch (cause) {
        setStatus(`Could not reload ${basename(current.path)}: ${message(cause)}`);
      }
    }
    await refreshGit();
  }
  async function requestClose() {
    const dirty = docs().filter(isDirty);
    if (!dirty.length) {
      props.onClose();
      return;
    }
    const choice = await context.ui.dialog.select({
      title: `Close the browser? ${dirty.length} unsaved ${dirty.length === 1 ? "file" : "files"}`,
      options: [{
        title: "Save all and close",
        value: "save"
      }, {
        title: "Close without saving",
        value: "discard"
      }, {
        title: "Cancel",
        value: "cancel"
      }]
    });
    if (choice === "cancel" || !choice) return;
    if (choice === "save") {
      for (const item of dirty) await save(item);
      if (docs().some(isDirty)) return;
    }
    props.onClose();
  }
  const [pending, updatePending] = context.storage.memory("pending", {
    initial: {
      seq: 0
    }
  });
  const [action, updateAction] = context.storage.memory("action", {
    initial: {
      seq: 0
    }
  });
  let lastAction = 0;
  createEffect(() => {
    const seq = action.seq;
    if (!seq || seq === lastAction) return;
    lastAction = seq;
    const name = action.name;
    void updateAction(draft => {
      draft.name = undefined;
    });
    if (!name) return;
    if (name === "settings") openSettings();
    if (name === "help") showHelp();
    if (name === "close") void requestClose();
    if (name === "refresh") void refresh();
    if (name === "changes") {
      setFocus("changes");
      void refreshGit();
    }
    if (name === "stage") void git.stage(props.location().directory).then(refreshGit);
    if (name === "hidden") void settings.update(draft => (draft.hidden = !draft.hidden, undefined)).then(refreshTree);
    if (name === "lineNumbers") void settings.update(draft => (draft.lineNumbers = !draft.lineNumbers, undefined));
    if (name === "simple") void settings.update(draft => (draft.simple = !draft.simple, undefined));
  });
  createEffect(() => {
    const request = pending.path;
    if (!request) return;
    void updatePending(draft => {
      draft.path = undefined;
    });
    void openByPath(request);
  });
  let lastRoot;
  createEffect(() => {
    const root = props.location().directory;
    if (root === lastRoot) return;
    lastRoot = root;
    setStatus(undefined);
    setQuery("");
    setHits([]);
    setFound([]);
    if (restored.root === root && restored.docs?.length) {
      setDocs(restored.docs);
      setActive(Math.min(restored.active ?? 0, restored.docs.length - 1));
      setModes(restored.modes ?? {});
      setPreviews(restored.previews ?? {});
      setNavRoot(restored.navRoot ?? "");
    } else {
      setDocs([]);
      setActive(-1);
      setNavRoot("");
    }
    void refreshTree();
    void refreshGit();
  });

  // Switching between in-place expansion and navigate mode starts from the
  // project root so the list never shows stale rows.
  let lastTree;
  createEffect(() => {
    const mode = options().tree;
    if (mode === lastTree) return;
    lastTree = mode;
    setNavRoot("");
    setExpanded([]);
    setIndex(0);
  });

  // Keep focus on a pane that exists when simple mode hides the git panel.
  createEffect(() => {
    if (!showChanges() && focus() === "changes") setFocus("editor");
  });

  // Keep the selected row visible.
  let listScroll;
  createEffect(() => {
    if (focus() !== "explorer" && searchInput && !searchInput.isDestroyed) {
      try {
        searchInput.blur();
      } catch {}
    }
  });
  createEffect(() => {
    const selected = index();
    if (!rows().length) return;
    const scroll = listScroll;
    if (!scroll || scroll.isDestroyed) return;
    if (selected < scroll.scrollTop) scroll.scrollTo(selected);else if (selected + 1 > scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(selected + 1 - scroll.viewport.height);
  });
  const headerCount = () => {
    if (searchMode() === "content" && query().trim().length >= 2) return `${hits().length}${hitsTruncated() ? "+" : ""} hits`;
    if (searchMode() === "name" && query().trim().length >= 2) return `${rows().length} matches`;
    return `${rows().filter(row => row.depth === 0).length} items`;
  };
  const branch = () => gitState().repo ? gitState().branch : "";
  const tabLabel = item => `${isDirty(item) ? "● " : ""}${item.diff ? "Δ " : ""}${basename(item.rawPath ?? item.path)}`;
  const Tab = tabProps => {
    const [hovered, setHovered] = createSignal(false);
    return (() => {
      var _el$1 = _$createElement("box"),
        _el$10 = _$createElement("text"),
        _el$11 = _$createElement("text");
      _$insertNode(_el$1, _el$10);
      _$insertNode(_el$1, _el$11);
      _$setProp(_el$1, "flexDirection", "row");
      _$setProp(_el$1, "flexShrink", 0);
      _$setProp(_el$1, "paddingLeft", 1);
      _$setProp(_el$1, "paddingRight", 1);
      _$setProp(_el$1, "onMouseOver", () => setHovered(true));
      _$setProp(_el$1, "onMouseOut", () => setHovered(false));
      _$setProp(_el$1, "onMouseUp", event => {
        if (!options().mouse) return;
        if (event.button === MouseButton.RIGHT) {
          event.stopPropagation();
          setActive(tabProps.position);
          void openContext("tab", tabProps.item);
          return;
        }
        if (event.button === MouseButton.MIDDLE) {
          event.stopPropagation();
          closeDoc(tabProps.position);
          return;
        }
        if (event.button !== MouseButton.LEFT) return;
        event.stopPropagation();
        setActive(tabProps.position);
        setFocus("editor");
      });
      _$setProp(_el$10, "wrapMode", "none");
      _$insert(_el$10, () => tabLabel(tabProps.item));
      _$insertNode(_el$11, _$createTextNode(`×`));
      _$setProp(_el$11, "wrapMode", "none");
      _$setProp(_el$11, "paddingLeft", 1);
      _$setProp(_el$11, "onMouseUp", event => {
        if (!options().mouse || event.button !== MouseButton.LEFT) return;
        event.stopPropagation();
        closeDoc(tabProps.position);
      });
      _$effect(_p$ => {
        var _v$6 = tabProps.position === active() ? theme.background.raised.max : hovered() ? theme.background.raised.high : surface(),
          _v$7 = tabProps.position === active() ? theme.text.action.primary.selected : theme.text.muted,
          _v$8 = tabProps.position === active() ? TextAttributes.BOLD : 0,
          _v$9 = theme.text.muted;
        _v$6 !== _p$.e && (_p$.e = _$setProp(_el$1, "backgroundColor", _v$6, _p$.e));
        _v$7 !== _p$.t && (_p$.t = _$setProp(_el$10, "fg", _v$7, _p$.t));
        _v$8 !== _p$.a && (_p$.a = _$setProp(_el$10, "attributes", _v$8, _p$.a));
        _v$9 !== _p$.o && (_p$.o = _$setProp(_el$11, "fg", _v$9, _p$.o));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined
      });
      return _el$1;
    })();
  };
  const RowView = rowProps => {
    const [hovered, setHovered] = createSignal(false);
    const icon = () => iconFor(rowProps.row, theme);
    const isOpen = () => rowProps.row.type === "directory" && expanded().includes(rowProps.row.path);
    return (() => {
      var _el$13 = _$createElement("box"),
        _el$14 = _$createElement("text"),
        _el$15 = _$createElement("text");
      _$insertNode(_el$13, _el$14);
      _$insertNode(_el$13, _el$15);
      _$setProp(_el$13, "flexDirection", "row");
      _$setProp(_el$13, "height", 1);
      _$setProp(_el$13, "flexShrink", 0);
      _$setProp(_el$13, "paddingRight", 1);
      _$setProp(_el$13, "onMouseOver", () => setHovered(true));
      _$setProp(_el$13, "onMouseOut", () => setHovered(false));
      _$setProp(_el$13, "onMouseUp", event => {
        if (!options().mouse) return;
        if (event.button === MouseButton.RIGHT) {
          event.stopPropagation();
          setFocus("explorer");
          setIndex(rowProps.position);
          void openContext("tree", rowProps.row);
          return;
        }
        if (event.button !== MouseButton.LEFT) return;
        event.stopPropagation();
        setFocus("explorer");
        setIndex(rowProps.position);
        void openRow(rowProps.row);
      });
      _$setProp(_el$14, "wrapMode", "none");
      _$setProp(_el$14, "selectable", false);
      _$setProp(_el$14, "flexShrink", 0);
      _$insert(_el$14, (() => {
        var _c$ = _$memo(() => !!rowProps.row.parent);
        return () => _c$() ? "↰ " : _$memo(() => rowProps.row.type === "directory")() ? _$memo(() => !!navigate())() ? "▸ " : isOpen() ? "▾ " : "▸ " : `${icon().glyph} `;
      })());
      _$setProp(_el$15, "wrapMode", "none");
      _$setProp(_el$15, "truncate", true);
      _$setProp(_el$15, "flexShrink", 0);
      _$insert(_el$15, (() => {
        var _c$2 = _$memo(() => !!rowProps.row.parent);
        return () => _c$2() ? ".." : _$memo(() => rowProps.row.type === "hit")() ? `${rowProps.row.path}:${rowProps.row.line}` : `${basename(rowProps.row.path)}${rowProps.row.type === "directory" ? "/" : ""}`;
      })());
      _$insert(_el$13, _$createComponent(Show, {
        get when() {
          return rowProps.row.type === "hit";
        },
        get children() {
          var _el$16 = _$createElement("box"),
            _el$17 = _$createElement("text");
          _$insertNode(_el$16, _el$17);
          _$setProp(_el$16, "paddingLeft", 1);
          _$setProp(_el$16, "minWidth", 0);
          _$setProp(_el$16, "flexGrow", 1);
          _$setProp(_el$17, "wrapMode", "none");
          _$setProp(_el$17, "truncate", true);
          _$insert(_el$17, () => rowProps.row.preview);
          _$effect(_$p => _$setProp(_el$17, "fg", theme.text.muted, _$p));
          return _el$16;
        }
      }), null);
      _$effect(_p$ => {
        var _v$0 = 1 + rowProps.row.depth * 2,
          _v$1 = rowProps.position === index() && focus() === "explorer" ? theme.background.raised.max : hovered() ? theme.background.raised.high : surface(),
          _v$10 = icon().color,
          _v$11 = rowProps.position === index() && focus() === "explorer" ? theme.text.action.primary.selected : rowProps.row.type === "directory" ? theme.text.action.secondary.base : theme.text.base;
        _v$0 !== _p$.e && (_p$.e = _$setProp(_el$13, "paddingLeft", _v$0, _p$.e));
        _v$1 !== _p$.t && (_p$.t = _$setProp(_el$13, "backgroundColor", _v$1, _p$.t));
        _v$10 !== _p$.a && (_p$.a = _$setProp(_el$14, "fg", _v$10, _p$.a));
        _v$11 !== _p$.o && (_p$.o = _$setProp(_el$15, "fg", _v$11, _p$.o));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined
      });
      return _el$13;
    })();
  };
  const ChangeRow = changeProps => (() => {
    var _el$18 = _$createElement("box"),
      _el$19 = _$createElement("text"),
      _el$20 = _$createTextNode(` `),
      _el$21 = _$createElement("text");
    _$insertNode(_el$18, _el$19);
    _$insertNode(_el$18, _el$21);
    _$setProp(_el$18, "flexDirection", "row");
    _$setProp(_el$18, "height", 1);
    _$setProp(_el$18, "paddingLeft", 1);
    _$setProp(_el$18, "paddingRight", 1);
    _$setProp(_el$18, "onMouseOver", () => setHoveredChange(changeProps.position));
    _$setProp(_el$18, "onMouseOut", () => setHoveredChange(-1));
    _$setProp(_el$18, "onMouseUp", event => {
      if (!options().mouse || event.button !== MouseButton.LEFT) return;
      event.stopPropagation();
      setFocus("changes");
      setChangeIndex(changeProps.position);
      void openDiff(changeProps.change);
    });
    _$insertNode(_el$19, _el$20);
    _$setProp(_el$19, "wrapMode", "none");
    _$insert(_el$19, () => CHANGE_LETTER[changeProps.change.status] ?? "M", _el$20);
    _$setProp(_el$21, "wrapMode", "none");
    _$setProp(_el$21, "truncate", true);
    _$setProp(_el$21, "flexGrow", 1);
    _$insert(_el$21, () => changeProps.change.path);
    _$insert(_el$18, _$createComponent(Show, {
      get when() {
        return changeProps.change.staged;
      },
      get children() {
        var _el$22 = _$createElement("text");
        _$insertNode(_el$22, _$createTextNode(`staged`));
        _$setProp(_el$22, "wrapMode", "none");
        _$effect(_$p => _$setProp(_el$22, "fg", theme.text.muted, _$p));
        return _el$22;
      }
    }), null);
    _$effect(_p$ => {
      var _v$12 = changeProps.position === changeIndex() && focus() === "changes" ? theme.background.raised.max : hoveredChange() === changeProps.position ? theme.background.raised.high : surface(),
        _v$13 = changeProps.change.status === "deleted" ? theme.text.feedback.error.base : changeProps.change.status === "added" || changeProps.change.status === "untracked" ? theme.text.feedback.success.base : theme.text.feedback.warning.base,
        _v$14 = theme.text.base;
      _v$12 !== _p$.e && (_p$.e = _$setProp(_el$18, "backgroundColor", _v$12, _p$.e));
      _v$13 !== _p$.t && (_p$.t = _$setProp(_el$19, "fg", _v$13, _p$.t));
      _v$14 !== _p$.a && (_p$.a = _$setProp(_el$21, "fg", _v$14, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$18;
  })();
  const [hoveredChange, setHoveredChange] = createSignal(-1);
  const contentWidth = () => width() - explorerWidth() - (showChanges() ? 34 : 0);
  return (() => {
    var _el$24 = _$createElement("box"),
      _el$25 = _$createElement("box"),
      _el$26 = _$createElement("text"),
      _el$28 = _$createElement("text"),
      _el$30 = _$createElement("text"),
      _el$31 = _$createElement("box"),
      _el$84 = _$createElement("box"),
      _el$85 = _$createElement("text"),
      _el$86 = _$createElement("text");
    _$insertNode(_el$24, _el$25);
    _$insertNode(_el$24, _el$31);
    _$insertNode(_el$24, _el$84);
    _$setProp(_el$24, "width", "100%");
    _$setProp(_el$24, "height", "100%");
    _$setProp(_el$24, "flexDirection", "column");
    _$insertNode(_el$25, _el$26);
    _$insertNode(_el$25, _el$28);
    _$insertNode(_el$25, _el$30);
    _$setProp(_el$25, "height", 1);
    _$setProp(_el$25, "flexShrink", 0);
    _$setProp(_el$25, "paddingRight", 2);
    _$setProp(_el$25, "flexDirection", "row");
    _$setProp(_el$25, "gap", 1);
    _$insertNode(_el$26, _$createTextNode(`files`));
    _$setProp(_el$26, "wrapMode", "none");
    _$setProp(_el$28, "wrapMode", "none");
    _$setProp(_el$28, "truncate", true);
    _$setProp(_el$28, "flexGrow", 1);
    _$setProp(_el$28, "minWidth", 0);
    _$setProp(_el$28, "onMouseUp", event => {
      if (!options().mouse || event.button !== MouseButton.LEFT) return;
      if (!navigate() || !navRoot()) return;
      event.stopPropagation?.();
      void goUp();
    });
    _$insert(_el$28, () => context.ui.format.path(props.location().directory), null);
    _$insert(_el$28, (() => {
      var _c$3 = _$memo(() => !!navRoot());
      return () => _c$3() ? `/${navRoot()}` : "";
    })(), null);
    _$insert(_el$25, _$createComponent(Show, {
      get when() {
        return branch();
      },
      get children() {
        var _el$29 = _$createElement("text");
        _$setProp(_el$29, "wrapMode", "none");
        _$insert(_el$29, branch);
        _$effect(_$p => _$setProp(_el$29, "fg", theme.text.muted, _$p));
        return _el$29;
      }
    }), _el$30);
    _$setProp(_el$30, "wrapMode", "none");
    _$insert(_el$30, headerCount);
    _$setProp(_el$31, "flexDirection", "row");
    _$setProp(_el$31, "flexGrow", 1);
    _$setProp(_el$31, "minHeight", 0);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return !treeHidden();
      },
      get children() {
        var _el$32 = _$createElement("box"),
          _el$33 = _$createElement("box"),
          _el$34 = _$createElement("text"),
          _el$36 = _$createElement("text"),
          _el$37 = _$createTextNode(`[`),
          _el$38 = _$createTextNode(`]`),
          _el$39 = _$createElement("text"),
          _el$40 = _$createElement("text"),
          _el$42 = _$createElement("box"),
          _el$43 = _$createElement("input"),
          _el$44 = _$createElement("scrollbox");
        _$insertNode(_el$32, _el$33);
        _$insertNode(_el$32, _el$42);
        _$insertNode(_el$32, _el$44);
        _$setProp(_el$32, "flexShrink", 0);
        _$setProp(_el$32, "minHeight", 0);
        _$setProp(_el$32, "flexDirection", "column");
        _$insertNode(_el$33, _el$34);
        _$insertNode(_el$33, _el$36);
        _$insertNode(_el$33, _el$39);
        _$insertNode(_el$33, _el$40);
        _$setProp(_el$33, "height", 1);
        _$setProp(_el$33, "flexShrink", 0);
        _$setProp(_el$33, "paddingLeft", 1);
        _$setProp(_el$33, "paddingRight", 1);
        _$setProp(_el$33, "flexDirection", "row");
        _$setProp(_el$33, "gap", 1);
        _$insertNode(_el$34, _$createTextNode(`Explorer`));
        _$setProp(_el$34, "wrapMode", "none");
        _$insertNode(_el$36, _el$37);
        _$insertNode(_el$36, _el$38);
        _$setProp(_el$36, "wrapMode", "none");
        _$setProp(_el$36, "truncate", true);
        _$setProp(_el$36, "flexGrow", 1);
        _$insert(_el$36, () => searchMode() === "name" ? "names" : "content", _el$38);
        _$setProp(_el$39, "wrapMode", "none");
        _$insert(_el$39, () => loading() || searching() ? "…" : "");
        _$insertNode(_el$40, _$createTextNode(`«`));
        _$setProp(_el$40, "wrapMode", "none");
        _$setProp(_el$40, "selectable", false);
        _$setProp(_el$40, "onMouseUp", event => {
          if (!options().mouse || event.button !== MouseButton.LEFT) return;
          event.stopPropagation?.();
          setTreeHidden(true);
          if (focus() === "explorer") setFocus("editor");
        });
        _$insertNode(_el$42, _el$43);
        _$setProp(_el$42, "height", 1);
        _$setProp(_el$42, "flexShrink", 0);
        _$setProp(_el$42, "paddingLeft", 1);
        _$setProp(_el$42, "paddingRight", 1);
        _$use(element => {
          searchInput = element;
          element.on("focus", () => setInputFocus(true));
          element.on("blur", () => setInputFocus(false));
        }, _el$43);
        _$setProp(_el$43, "onInput", value => scheduleSearch(value));
        _$setProp(_el$43, "on:focus", () => setInputFocus(true));
        _$setProp(_el$43, "on:blur", () => setInputFocus(false));
        _$setProp(_el$43, "onKeyDown", event => {
          const key = String(event.name ?? event.key ?? "").toLowerCase();
          if (key === "escape") {
            scheduleSearch("");
            setInputFocus(false);
            try {
              searchInput?.blur();
            } catch {}
            return;
          }
          if (key === "down") {
            event.preventDefault?.();
            moveSelection(1);
            return;
          }
          if (key === "up") {
            event.preventDefault?.();
            moveSelection(-1);
            return;
          }
          if (key === "pagedown") {
            event.preventDefault?.();
            pageSelection(1);
            return;
          }
          if (key === "pageup") {
            event.preventDefault?.();
            pageSelection(-1);
            return;
          }
          if (key === "return") {
            const row = currentRow();
            if (!row) return;
            event.preventDefault?.();
            try {
              searchInput?.blur();
            } catch {}
            void openRow(row);
          }
        });
        _$use(element => listScroll = element, _el$44);
        _$setProp(_el$44, "flexGrow", 1);
        _$setProp(_el$44, "minHeight", 0);
        _$setProp(_el$44, "verticalScrollbarOptions", {
          visible: true
        });
        _$setProp(_el$44, "onMouseUp", event => {
          if (!options().mouse || event.button !== MouseButton.RIGHT) return;
          event.stopPropagation?.();
          setFocus("explorer");
          void openContext("tree", undefined, navigate() ? navRoot() : "");
        });
        _$insert(_el$44, _$createComponent(Show, {
          get when() {
            return error();
          },
          get children() {
            var _el$45 = _$createElement("text");
            _$setProp(_el$45, "paddingLeft", 1);
            _$setProp(_el$45, "wrapMode", "word");
            _$insert(_el$45, error);
            _$effect(_$p => _$setProp(_el$45, "fg", theme.text.feedback.error.base, _$p));
            return _el$45;
          }
        }), null);
        _$insert(_el$44, _$createComponent(Show, {
          get when() {
            return _$memo(() => !!!loading())() && rows().length === 0;
          },
          get children() {
            var _el$46 = _$createElement("box"),
              _el$47 = _$createElement("text");
            _$insertNode(_el$46, _el$47);
            _$setProp(_el$46, "paddingLeft", 1);
            _$setProp(_el$47, "wrapMode", "none");
            _$insert(_el$47, (() => {
              var _c$4 = _$memo(() => !!query().trim());
              return () => _c$4() ? "No matches" : navigate() && navRoot() ? "empty folder · ← or .. to go up" : "(empty)";
            })());
            _$effect(_$p => _$setProp(_el$47, "fg", theme.text.muted, _$p));
            return _el$46;
          }
        }), null);
        _$insert(_el$44, _$createComponent(For, {
          get each() {
            return rows();
          },
          children: (row, position) => _$createComponent(RowView, {
            row: row,
            get position() {
              return position();
            }
          })
        }), null);
        _$insert(_el$32, _$createComponent(Show, {
          get when() {
            return !simple();
          },
          get children() {
            var _el$48 = _$createElement("box"),
              _el$49 = _$createElement("text"),
              _el$50 = _$createElement("text");
            _$insertNode(_el$48, _el$49);
            _$insertNode(_el$48, _el$50);
            _$setProp(_el$48, "height", 1);
            _$setProp(_el$48, "flexShrink", 0);
            _$setProp(_el$48, "paddingLeft", 1);
            _$setProp(_el$48, "paddingRight", 1);
            _$setProp(_el$48, "flexDirection", "row");
            _$setProp(_el$48, "gap", 1);
            _$setProp(_el$49, "wrapMode", "none");
            _$setProp(_el$49, "truncate", true);
            _$setProp(_el$49, "flexGrow", 1);
            _$insert(_el$49, (() => {
              var _c$5 = _$memo(() => !!gitState().repo);
              return () => _c$5() ? `±${gitState().changes.length} changes` : "no repository";
            })());
            _$insertNode(_el$50, _$createTextNode(`ctrl+e`));
            _$setProp(_el$50, "wrapMode", "none");
            _$effect(_p$ => {
              var _v$15 = theme.text.muted,
                _v$16 = theme.text.muted;
              _v$15 !== _p$.e && (_p$.e = _$setProp(_el$49, "fg", _v$15, _p$.e));
              _v$16 !== _p$.t && (_p$.t = _$setProp(_el$50, "fg", _v$16, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$48;
          }
        }), null);
        _$effect(_p$ => {
          var _v$17 = explorerWidth(),
            _v$18 = surface(),
            _v$19 = !docked(),
            _v$20 = focus() === "explorer" ? theme.border.base : theme.background.raised.base,
            _v$21 = theme.text.base,
            _v$22 = TextAttributes.BOLD,
            _v$23 = theme.text.muted,
            _v$24 = theme.text.muted,
            _v$25 = theme.text.muted,
            _v$26 = query(),
            _v$27 = searchMode() === "name" ? "Search files…" : "Search content…",
            _v$28 = surface(),
            _v$29 = theme.text.base,
            _v$30 = theme.text.base;
          _v$17 !== _p$.e && (_p$.e = _$setProp(_el$32, "width", _v$17, _p$.e));
          _v$18 !== _p$.t && (_p$.t = _$setProp(_el$32, "backgroundColor", _v$18, _p$.t));
          _v$19 !== _p$.a && (_p$.a = _$setProp(_el$32, "border", _v$19, _p$.a));
          _v$20 !== _p$.o && (_p$.o = _$setProp(_el$32, "borderColor", _v$20, _p$.o));
          _v$21 !== _p$.i && (_p$.i = _$setProp(_el$34, "fg", _v$21, _p$.i));
          _v$22 !== _p$.n && (_p$.n = _$setProp(_el$34, "attributes", _v$22, _p$.n));
          _v$23 !== _p$.s && (_p$.s = _$setProp(_el$36, "fg", _v$23, _p$.s));
          _v$24 !== _p$.h && (_p$.h = _$setProp(_el$39, "fg", _v$24, _p$.h));
          _v$25 !== _p$.r && (_p$.r = _$setProp(_el$40, "fg", _v$25, _p$.r));
          _v$26 !== _p$.d && (_p$.d = _$setProp(_el$43, "value", _v$26, _p$.d));
          _v$27 !== _p$.l && (_p$.l = _$setProp(_el$43, "placeholder", _v$27, _p$.l));
          _v$28 !== _p$.u && (_p$.u = _$setProp(_el$43, "backgroundColor", _v$28, _p$.u));
          _v$29 !== _p$.c && (_p$.c = _$setProp(_el$43, "textColor", _v$29, _p$.c));
          _v$30 !== _p$.w && (_p$.w = _$setProp(_el$43, "focusedTextColor", _v$30, _p$.w));
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
          w: undefined
        });
        return _el$32;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return treeHidden();
      },
      get children() {
        var _el$52 = _$createElement("box"),
          _el$53 = _$createElement("text");
        _$insertNode(_el$52, _el$53);
        _$setProp(_el$52, "width", 2);
        _$setProp(_el$52, "flexShrink", 0);
        _$setProp(_el$52, "flexDirection", "column");
        _$setProp(_el$52, "alignItems", "center");
        _$setProp(_el$52, "onMouseUp", event => {
          if (!options().mouse || event.button !== MouseButton.LEFT) return;
          event.stopPropagation?.();
          setTreeHidden(false);
        });
        _$insertNode(_el$53, _$createTextNode(`»`));
        _$setProp(_el$53, "wrapMode", "none");
        _$setProp(_el$53, "selectable", false);
        _$effect(_p$ => {
          var _v$31 = surface(),
            _v$32 = theme.text.action.primary.selected;
          _v$31 !== _p$.e && (_p$.e = _$setProp(_el$52, "backgroundColor", _v$31, _p$.e));
          _v$32 !== _p$.t && (_p$.t = _$setProp(_el$53, "fg", _v$32, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$52;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return showEditor();
      },
      get children() {
        var _el$55 = _$createElement("box");
        _$setProp(_el$55, "flexGrow", 1);
        _$setProp(_el$55, "minWidth", 0);
        _$setProp(_el$55, "minHeight", 0);
        _$setProp(_el$55, "flexDirection", "column");
        _$insert(_el$55, _$createComponent(Show, {
          get when() {
            return _$memo(() => !!!simple())() && docs().length > 0;
          },
          get children() {
            var _el$56 = _$createElement("box"),
              _el$57 = _$createElement("text");
            _$insertNode(_el$56, _el$57);
            _$setProp(_el$56, "height", 1);
            _$setProp(_el$56, "flexShrink", 0);
            _$setProp(_el$56, "flexDirection", "row");
            _$setProp(_el$56, "overflow", "hidden");
            _$insert(_el$56, _$createComponent(For, {
              get each() {
                return docs();
              },
              children: (item, position) => _$createComponent(Tab, {
                item: item,
                get position() {
                  return position();
                }
              })
            }), _el$57);
            _$insertNode(_el$57, _$createTextNode(` `));
            _$setProp(_el$57, "flexGrow", 1);
            _$setProp(_el$57, "wrapMode", "none");
            _$effect(_$p => _$setProp(_el$57, "fg", theme.text.muted, _$p));
            return _el$56;
          }
        }), null);
        _$insert(_el$55, _$createComponent(Show, {
          get when() {
            return doc()?.path;
          },
          keyed: true,
          get fallback() {
            return (() => {
              var _el$89 = _$createElement("box"),
                _el$90 = _$createElement("text"),
                _el$91 = _$createElement("text");
              _$insertNode(_el$89, _el$90);
              _$insertNode(_el$89, _el$91);
              _$setProp(_el$89, "flexGrow", 1);
              _$setProp(_el$89, "minHeight", 0);
              _$setProp(_el$89, "flexDirection", "column");
              _$setProp(_el$89, "alignItems", "center");
              _$setProp(_el$89, "justifyContent", "center");
              _$setProp(_el$89, "gap", 1);
              _$insert(_el$90, () => simple() ? "File browser" : "OpenCode files");
              _$insert(_el$91, () => simple() || docked() ? "Select a file on the left and press Enter." : "Browse, edit and review without leaving the TUI.");
              _$insert(_el$89, _$createComponent(Show, {
                get when() {
                  return _$memo(() => !!docked())() && !simple();
                },
                get children() {
                  var _el$92 = _$createElement("text");
                  _$insertNode(_el$92, _$createTextNode(`tab pane · ctrl+f search · e edit · ctrl+s save`));
                  _$setProp(_el$92, "wrapMode", "word");
                  _$effect(_$p => _$setProp(_el$92, "fg", theme.text.muted, _$p));
                  return _el$92;
                }
              }), null);
              _$insert(_el$89, _$createComponent(Show, {
                get when() {
                  return _$memo(() => !!!simple())() && !docked();
                },
                get children() {
                  var _el$94 = _$createElement("box"),
                    _el$95 = _$createElement("text"),
                    _el$97 = _$createElement("box"),
                    _el$98 = _$createElement("text"),
                    _el$100 = _$createElement("text"),
                    _el$102 = _$createElement("box"),
                    _el$103 = _$createElement("text"),
                    _el$105 = _$createElement("text"),
                    _el$107 = _$createElement("box"),
                    _el$108 = _$createElement("text"),
                    _el$110 = _$createElement("text"),
                    _el$112 = _$createElement("box"),
                    _el$113 = _$createElement("text"),
                    _el$115 = _$createElement("text"),
                    _el$117 = _$createElement("box"),
                    _el$118 = _$createElement("text"),
                    _el$120 = _$createElement("text"),
                    _el$122 = _$createElement("box"),
                    _el$123 = _$createElement("text"),
                    _el$125 = _$createElement("text");
                  _$insertNode(_el$94, _el$95);
                  _$insertNode(_el$94, _el$97);
                  _$insertNode(_el$94, _el$102);
                  _$insertNode(_el$94, _el$107);
                  _$insertNode(_el$94, _el$112);
                  _$insertNode(_el$94, _el$117);
                  _$insertNode(_el$94, _el$122);
                  _$setProp(_el$94, "flexDirection", "column");
                  _$setProp(_el$94, "gap", 1);
                  _$setProp(_el$94, "paddingTop", 1);
                  _$setProp(_el$94, "border", true);
                  _$setProp(_el$94, "paddingLeft", 2);
                  _$setProp(_el$94, "paddingRight", 2);
                  _$insertNode(_el$95, _$createTextNode(`Quick start`));
                  _$insertNode(_el$97, _el$98);
                  _$insertNode(_el$97, _el$100);
                  _$setProp(_el$97, "flexDirection", "row");
                  _$setProp(_el$97, "gap", 2);
                  _$insertNode(_el$98, _$createTextNode(`↑ ↓ enter`));
                  _$setProp(_el$98, "wrapMode", "none");
                  _$setProp(_el$98, "width", 18);
                  _$insertNode(_el$100, _$createTextNode(`move and open`));
                  _$setProp(_el$100, "wrapMode", "none");
                  _$insertNode(_el$102, _el$103);
                  _$insertNode(_el$102, _el$105);
                  _$setProp(_el$102, "flexDirection", "row");
                  _$setProp(_el$102, "gap", 2);
                  _$insertNode(_el$103, _$createTextNode(`ctrl+f / ctrl+e`));
                  _$setProp(_el$103, "wrapMode", "none");
                  _$setProp(_el$103, "width", 18);
                  _$insertNode(_el$105, _$createTextNode(`search names or content`));
                  _$setProp(_el$105, "wrapMode", "none");
                  _$insertNode(_el$107, _el$108);
                  _$insertNode(_el$107, _el$110);
                  _$setProp(_el$107, "flexDirection", "row");
                  _$setProp(_el$107, "gap", 2);
                  _$insertNode(_el$108, _$createTextNode(`e / ctrl+s`));
                  _$setProp(_el$108, "wrapMode", "none");
                  _$setProp(_el$108, "width", 18);
                  _$insertNode(_el$110, _$createTextNode(`edit and save`));
                  _$setProp(_el$110, "wrapMode", "none");
                  _$insertNode(_el$112, _el$113);
                  _$insertNode(_el$112, _el$115);
                  _$setProp(_el$112, "flexDirection", "row");
                  _$setProp(_el$112, "gap", 2);
                  _$insertNode(_el$113, _$createTextNode(`ctrl+g`));
                  _$setProp(_el$113, "wrapMode", "none");
                  _$setProp(_el$113, "width", 18);
                  _$insertNode(_el$115, _$createTextNode(`git changes, stage and commit`));
                  _$setProp(_el$115, "wrapMode", "none");
                  _$insertNode(_el$117, _el$118);
                  _$insertNode(_el$117, _el$120);
                  _$setProp(_el$117, "flexDirection", "row");
                  _$setProp(_el$117, "gap", 2);
                  _$insertNode(_el$118, _$createTextNode(`F2`));
                  _$setProp(_el$118, "wrapMode", "none");
                  _$setProp(_el$118, "width", 18);
                  _$insertNode(_el$120, _$createTextNode(`preferences, including simple mode`));
                  _$setProp(_el$120, "wrapMode", "none");
                  _$insertNode(_el$122, _el$123);
                  _$insertNode(_el$122, _el$125);
                  _$setProp(_el$122, "flexDirection", "row");
                  _$setProp(_el$122, "gap", 2);
                  _$insertNode(_el$123, _$createTextNode(`F1`));
                  _$setProp(_el$123, "wrapMode", "none");
                  _$setProp(_el$123, "width", 18);
                  _$insertNode(_el$125, _$createTextNode(`every shortcut`));
                  _$setProp(_el$125, "wrapMode", "none");
                  _$effect(_p$ => {
                    var _v$58 = theme.border.base,
                      _v$59 = theme.text.action.primary.selected,
                      _v$60 = TextAttributes.BOLD,
                      _v$61 = theme.text.muted,
                      _v$62 = theme.text.base,
                      _v$63 = theme.text.muted,
                      _v$64 = theme.text.base,
                      _v$65 = theme.text.muted,
                      _v$66 = theme.text.base,
                      _v$67 = theme.text.muted,
                      _v$68 = theme.text.base,
                      _v$69 = theme.text.muted,
                      _v$70 = theme.text.base,
                      _v$71 = theme.text.muted,
                      _v$72 = theme.text.base;
                    _v$58 !== _p$.e && (_p$.e = _$setProp(_el$94, "borderColor", _v$58, _p$.e));
                    _v$59 !== _p$.t && (_p$.t = _$setProp(_el$95, "fg", _v$59, _p$.t));
                    _v$60 !== _p$.a && (_p$.a = _$setProp(_el$95, "attributes", _v$60, _p$.a));
                    _v$61 !== _p$.o && (_p$.o = _$setProp(_el$98, "fg", _v$61, _p$.o));
                    _v$62 !== _p$.i && (_p$.i = _$setProp(_el$100, "fg", _v$62, _p$.i));
                    _v$63 !== _p$.n && (_p$.n = _$setProp(_el$103, "fg", _v$63, _p$.n));
                    _v$64 !== _p$.s && (_p$.s = _$setProp(_el$105, "fg", _v$64, _p$.s));
                    _v$65 !== _p$.h && (_p$.h = _$setProp(_el$108, "fg", _v$65, _p$.h));
                    _v$66 !== _p$.r && (_p$.r = _$setProp(_el$110, "fg", _v$66, _p$.r));
                    _v$67 !== _p$.d && (_p$.d = _$setProp(_el$113, "fg", _v$67, _p$.d));
                    _v$68 !== _p$.l && (_p$.l = _$setProp(_el$115, "fg", _v$68, _p$.l));
                    _v$69 !== _p$.u && (_p$.u = _$setProp(_el$118, "fg", _v$69, _p$.u));
                    _v$70 !== _p$.c && (_p$.c = _$setProp(_el$120, "fg", _v$70, _p$.c));
                    _v$71 !== _p$.w && (_p$.w = _$setProp(_el$123, "fg", _v$71, _p$.w));
                    _v$72 !== _p$.m && (_p$.m = _$setProp(_el$125, "fg", _v$72, _p$.m));
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
                    m: undefined
                  });
                  return _el$94;
                }
              }), null);
              _$effect(_p$ => {
                var _v$73 = theme.text.base,
                  _v$74 = TextAttributes.BOLD,
                  _v$75 = theme.text.muted;
                _v$73 !== _p$.e && (_p$.e = _$setProp(_el$90, "fg", _v$73, _p$.e));
                _v$74 !== _p$.t && (_p$.t = _$setProp(_el$90, "attributes", _v$74, _p$.t));
                _v$75 !== _p$.a && (_p$.a = _$setProp(_el$91, "fg", _v$75, _p$.a));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$89;
            })();
          },
          get children() {
            return _$createComponent(ErrorBoundary, {
              fallback: cause => (() => {
                var _el$127 = _$createElement("box"),
                  _el$128 = _$createElement("text"),
                  _el$129 = _$createTextNode(`Could not render this file: `);
                _$insertNode(_el$127, _el$128);
                _$setProp(_el$127, "flexGrow", 1);
                _$setProp(_el$127, "padding", 1);
                _$insertNode(_el$128, _el$129);
                _$setProp(_el$128, "wrapMode", "word");
                _$insert(_el$128, () => message(cause), null);
                _$effect(_$p => _$setProp(_el$128, "fg", theme.text.feedback.error.base, _$p));
                return _el$127;
              })(),
              get children() {
                var _el$59 = _$createElement("box");
                _$setProp(_el$59, "flexGrow", 1);
                _$setProp(_el$59, "minHeight", 0);
                _$setProp(_el$59, "flexDirection", "column");
                _$insert(_el$59, _$createComponent(EditorView, {
                  get doc() {
                    return doc();
                  },
                  theme: theme,
                  syntax: syntax,
                  get settings() {
                    return options();
                  },
                  get editing() {
                    return isEditing();
                  },
                  get markdownPreview() {
                    return showMarkdown();
                  },
                  get focused() {
                    return focus() === "editor";
                  },
                  get line() {
                    return pendingLine();
                  },
                  get initialScroll() {
                    return positions.get(doc().path)?.scroll ?? 0;
                  },
                  get initialLine() {
                    return positions.get(doc().path)?.line;
                  },
                  get initialColumn() {
                    return positions.get(doc().path)?.column;
                  },
                  onPosition: position => {
                    const path = doc()?.path;
                    if (!path) return;
                    positions.set(path, {
                      ...positions.get(path),
                      ...position
                    });
                  },
                  onText: text => updateDoc(doc(), text),
                  onSave: () => void save(),
                  onCursor: () => {},
                  onLeave: () => setFocus("explorer"),
                  onKey: editorKey,
                  onToggleMode: toggleEdit,
                  onReady: api => editorApi = api
                }));
                return _el$59;
              }
            });
          }
        }), null);
        _$effect(_$p => _$setProp(_el$55, "backgroundColor", surface(), _$p));
        return _el$55;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return showChanges();
      },
      get children() {
        var _el$60 = _$createElement("box"),
          _el$61 = _$createElement("box"),
          _el$62 = _$createElement("text"),
          _el$64 = _$createElement("text"),
          _el$65 = _$createElement("text"),
          _el$66 = _$createTextNode(` staged`),
          _el$67 = _$createElement("scrollbox"),
          _el$72 = _$createElement("box"),
          _el$73 = _$createElement("text"),
          _el$75 = _$createElement("text"),
          _el$77 = _$createElement("text"),
          _el$79 = _$createElement("text");
        _$insertNode(_el$60, _el$61);
        _$insertNode(_el$60, _el$67);
        _$insertNode(_el$60, _el$72);
        _$setProp(_el$60, "width", 30);
        _$setProp(_el$60, "flexShrink", 0);
        _$setProp(_el$60, "minHeight", 0);
        _$setProp(_el$60, "flexDirection", "column");
        _$setProp(_el$60, "border", true);
        _$insertNode(_el$61, _el$62);
        _$insertNode(_el$61, _el$64);
        _$insertNode(_el$61, _el$65);
        _$setProp(_el$61, "height", 1);
        _$setProp(_el$61, "flexShrink", 0);
        _$setProp(_el$61, "paddingLeft", 1);
        _$setProp(_el$61, "paddingRight", 1);
        _$setProp(_el$61, "flexDirection", "row");
        _$setProp(_el$61, "gap", 1);
        _$insertNode(_el$62, _$createTextNode(`CHANGES`));
        _$setProp(_el$62, "wrapMode", "none");
        _$setProp(_el$64, "wrapMode", "none");
        _$setProp(_el$64, "flexGrow", 1);
        _$insert(_el$64, () => gitState().changes.length);
        _$insertNode(_el$65, _el$66);
        _$setProp(_el$65, "wrapMode", "none");
        _$insert(_el$65, () => gitState().staged, _el$66);
        _$setProp(_el$67, "flexGrow", 1);
        _$setProp(_el$67, "minHeight", 0);
        _$setProp(_el$67, "verticalScrollbarOptions", {
          visible: true
        });
        _$insert(_el$67, _$createComponent(Show, {
          get when() {
            return gitState().changes.length === 0;
          },
          get children() {
            var _el$68 = _$createElement("text");
            _$insertNode(_el$68, _$createTextNode(`No changes`));
            _$setProp(_el$68, "paddingLeft", 1);
            _$effect(_$p => _$setProp(_el$68, "fg", theme.text.muted, _$p));
            return _el$68;
          }
        }), null);
        _$insert(_el$67, _$createComponent(For, {
          get each() {
            return gitState().changes;
          },
          children: (change, position) => _$createComponent(ChangeRow, {
            change: change,
            get position() {
              return position();
            }
          })
        }), null);
        _$insert(_el$60, _$createComponent(Show, {
          get when() {
            return composing();
          },
          get children() {
            var _el$70 = _$createElement("box"),
              _el$71 = _$createElement("input");
            _$insertNode(_el$70, _el$71);
            _$setProp(_el$70, "height", 1);
            _$setProp(_el$70, "flexShrink", 0);
            _$setProp(_el$70, "paddingLeft", 1);
            _$setProp(_el$70, "paddingRight", 1);
            _$use(element => {
              commitInput = element;
              setTimeout(() => {
                try {
                  element.focus();
                } catch {}
              }, 20);
            }, _el$71);
            _$setProp(_el$71, "placeholder", "Commit message…");
            _$setProp(_el$71, "focused", true);
            _$setProp(_el$71, "onInput", value => setCommitMessage(value));
            _$setProp(_el$71, "onKeyDown", event => {
              const key = String(event.name ?? event.key ?? "").toLowerCase();
              if (key === "escape") {
                setComposing(false);
                return;
              }
              if (key === "return" && (event.ctrl || event.meta)) {
                setComposing(false);
                void runGitAction("commit");
              }
            });
            _$effect(_p$ => {
              var _v$33 = commitMessage(),
                _v$34 = surface(),
                _v$35 = theme.text.base,
                _v$36 = theme.text.base;
              _v$33 !== _p$.e && (_p$.e = _$setProp(_el$71, "value", _v$33, _p$.e));
              _v$34 !== _p$.t && (_p$.t = _$setProp(_el$71, "backgroundColor", _v$34, _p$.t));
              _v$35 !== _p$.a && (_p$.a = _$setProp(_el$71, "textColor", _v$35, _p$.a));
              _v$36 !== _p$.o && (_p$.o = _$setProp(_el$71, "focusedTextColor", _v$36, _p$.o));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            return _el$70;
          }
        }), _el$72);
        _$insertNode(_el$72, _el$73);
        _$insertNode(_el$72, _el$75);
        _$insertNode(_el$72, _el$77);
        _$insertNode(_el$72, _el$79);
        _$setProp(_el$72, "flexShrink", 0);
        _$setProp(_el$72, "flexDirection", "column");
        _$setProp(_el$72, "paddingLeft", 1);
        _$setProp(_el$72, "paddingRight", 1);
        _$insertNode(_el$73, _$createTextNode(`a stage · u unstage`));
        _$setProp(_el$73, "wrapMode", "none");
        _$insertNode(_el$75, _$createTextNode(`d discard · c commit`));
        _$setProp(_el$75, "wrapMode", "none");
        _$insertNode(_el$77, _$createTextNode(`l pull · p push`));
        _$setProp(_el$77, "wrapMode", "none");
        _$insertNode(_el$79, _$createTextNode(`g history · b branch · R`));
        _$setProp(_el$79, "wrapMode", "none");
        _$effect(_p$ => {
          var _v$37 = focus() === "changes" ? theme.border.base : theme.background.raised.base,
            _v$38 = surface(),
            _v$39 = theme.text.base,
            _v$40 = TextAttributes.BOLD,
            _v$41 = theme.text.muted,
            _v$42 = theme.text.muted,
            _v$43 = theme.text.muted,
            _v$44 = theme.text.muted,
            _v$45 = theme.text.muted,
            _v$46 = theme.text.muted;
          _v$37 !== _p$.e && (_p$.e = _$setProp(_el$60, "borderColor", _v$37, _p$.e));
          _v$38 !== _p$.t && (_p$.t = _$setProp(_el$60, "backgroundColor", _v$38, _p$.t));
          _v$39 !== _p$.a && (_p$.a = _$setProp(_el$62, "fg", _v$39, _p$.a));
          _v$40 !== _p$.o && (_p$.o = _$setProp(_el$62, "attributes", _v$40, _p$.o));
          _v$41 !== _p$.i && (_p$.i = _$setProp(_el$64, "fg", _v$41, _p$.i));
          _v$42 !== _p$.n && (_p$.n = _$setProp(_el$65, "fg", _v$42, _p$.n));
          _v$43 !== _p$.s && (_p$.s = _$setProp(_el$73, "fg", _v$43, _p$.s));
          _v$44 !== _p$.h && (_p$.h = _$setProp(_el$75, "fg", _v$44, _p$.h));
          _v$45 !== _p$.r && (_p$.r = _$setProp(_el$77, "fg", _v$45, _p$.r));
          _v$46 !== _p$.d && (_p$.d = _$setProp(_el$79, "fg", _v$46, _p$.d));
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
          d: undefined
        });
        return _el$60;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!docked())() && options().mouse;
      },
      get children() {
        var _el$81 = _$createElement("box");
        _$setProp(_el$81, "width", 1);
        _$setProp(_el$81, "flexShrink", 0);
        _$setProp(_el$81, "onMouseDown", event => {
          if (event.button !== MouseButton.LEFT) return;
          event.stopPropagation();
          setDrag({
            active: true,
            width: explorerWidth()
          });
        });
        _$setProp(_el$81, "onMouseDrag", event => {
          if (!drag().active) return;
          event.stopPropagation();
          setSplitWidth(Math.max(18, Math.min(60, drag().width + event.deltaX)));
        });
        _$setProp(_el$81, "onMouseUp", () => setDrag({
          active: false,
          width: 0
        }));
        _$effect(_$p => _$setProp(_el$81, "backgroundColor", drag().active ? theme.border.base : surface(), _$p));
        return _el$81;
      }
    }), null);
    _$insert(_el$24, _$createComponent(Show, {
      get when() {
        return status();
      },
      get children() {
        var _el$82 = _$createElement("box"),
          _el$83 = _$createElement("text");
        _$insertNode(_el$82, _el$83);
        _$setProp(_el$82, "height", 1);
        _$setProp(_el$82, "flexShrink", 0);
        _$setProp(_el$82, "paddingRight", 2);
        _$setProp(_el$83, "wrapMode", "none");
        _$setProp(_el$83, "truncate", true);
        _$insert(_el$83, status);
        _$effect(_p$ => {
          var _v$47 = docked() ? 2 : 1,
            _v$48 = theme.text.feedback.info.base;
          _v$47 !== _p$.e && (_p$.e = _$setProp(_el$82, "paddingLeft", _v$47, _p$.e));
          _v$48 !== _p$.t && (_p$.t = _$setProp(_el$83, "fg", _v$48, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$82;
      }
    }), _el$84);
    _$insertNode(_el$84, _el$85);
    _$insertNode(_el$84, _el$86);
    _$setProp(_el$84, "height", 1);
    _$setProp(_el$84, "flexShrink", 0);
    _$setProp(_el$84, "paddingRight", 2);
    _$setProp(_el$84, "flexDirection", "row");
    _$setProp(_el$84, "gap", 1);
    _$setProp(_el$85, "wrapMode", "none");
    _$setProp(_el$85, "truncate", true);
    _$setProp(_el$85, "flexGrow", 1);
    _$insert(_el$85, (() => {
      var _c$6 = _$memo(() => !!typing());
      return () => _c$6() ? "typing · ctrl+s save · ctrl+←/→ tabs · esc leaves · F4 preview · F1 help" : _$memo(() => focus() === "changes")() ? "a stage · u unstage · d discard · c commit · l pull · p push · g history · b branches" : focus() === "editor" ? "e edit · ctrl+s save · ctrl+w close · ctrl+←/→ tabs · m markdown · F1 help" : "↑↓ move · enter open · right click actions · tab pane · ctrl+f search · F6 tree · F2 prefs · F1 help";
    })());
    _$setProp(_el$86, "wrapMode", "none");
    _$insert(_el$86, (() => {
      var _c$7 = _$memo(() => !!simple());
      return () => _c$7() ? "simple" : `${docs().length} tabs`;
    })());
    _$insert(_el$84, _$createComponent(Show, {
      get when() {
        return props.panel;
      },
      get children() {
        var _el$87 = _$createElement("text");
        _$insertNode(_el$87, _$createTextNode(`f fullscreen`));
        _$setProp(_el$87, "wrapMode", "none");
        _$effect(_$p => _$setProp(_el$87, "fg", theme.text.muted, _$p));
        return _el$87;
      }
    }), null);
    _$effect(_p$ => {
      var _v$49 = surface(),
        _v$50 = docked() ? 2 : 1,
        _v$51 = theme.text.base,
        _v$52 = TextAttributes.BOLD,
        _v$53 = theme.text.muted,
        _v$54 = theme.text.muted,
        _v$55 = docked() ? 2 : 1,
        _v$56 = theme.text.muted,
        _v$57 = theme.text.muted;
      _v$49 !== _p$.e && (_p$.e = _$setProp(_el$24, "backgroundColor", _v$49, _p$.e));
      _v$50 !== _p$.t && (_p$.t = _$setProp(_el$25, "paddingLeft", _v$50, _p$.t));
      _v$51 !== _p$.a && (_p$.a = _$setProp(_el$26, "fg", _v$51, _p$.a));
      _v$52 !== _p$.o && (_p$.o = _$setProp(_el$26, "attributes", _v$52, _p$.o));
      _v$53 !== _p$.i && (_p$.i = _$setProp(_el$28, "fg", _v$53, _p$.i));
      _v$54 !== _p$.n && (_p$.n = _$setProp(_el$30, "fg", _v$54, _p$.n));
      _v$55 !== _p$.s && (_p$.s = _$setProp(_el$84, "paddingLeft", _v$55, _p$.s));
      _v$56 !== _p$.h && (_p$.h = _$setProp(_el$85, "fg", _v$56, _p$.h));
      _v$57 !== _p$.r && (_p$.r = _$setProp(_el$86, "fg", _v$57, _p$.r));
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
      r: undefined
    });
    return _el$24;
  })();
}

// Built once per component instance; kept here so the theme rules stay in one
// place and nothing imports @opencode/theme at runtime.
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
  }), rule(["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], markdown.heading, {
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