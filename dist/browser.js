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
import { mkdir, readFile, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import { HEAVY_CHARS, HEAVY_LINES, MAX_CHARS, MAX_LINES, OVERSIZE_BYTES, OVERSIZE_LINES, basename, clampLongLines, expandHome, filetype, formatBytes, isBinary, isMarkdown, message, parentOf } from "./lib/util.js";
import { useSettings } from "./lib/settings.js";
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
      mode: "global",
      priority: 105,
      enabled: () => !!current && current.enabled(),
      commands: current?.keys() ?? []
    };
  });
  context.keymap.layer(() => {
    const current = controller();
    return {
      mode: "global",
      priority: 100,
      enabled: () => !!current && current.enabled() && !current.typing(),
      commands: current?.commands() ?? []
    };
  });
  context.keymap.layer(() => {
    const current = controller();
    return {
      mode: "global",
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
  const navigate = () => options().tree === "navigate";
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
    const root = navRoot();
    return (dirs()[root] ?? []).map(entry => ({
      path: entry.path,
      type: entry.type,
      depth: 0
    }));
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
    setNavRoot(target);
    setLoading(true);
    try {
      if (!dirs()[target]) await loadDirectory(target);
      setIndex(0);
    } catch (cause) {
      setStatus(`Could not open ${target}: ${message(cause)}`);
    } finally {
      setLoading(false);
    }
  }
  async function goUp() {
    if (!navRoot()) return false;
    await enterDirectory(parentOf(navRoot()));
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
    setExpanded([]);
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
      size: "large"
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
  async function openContext(kind, target) {
    const row = kind === "tree" ? target : undefined;
    const tabDoc = kind === "tab" ? target ?? doc() : doc();
    const base = row ? row.type === "directory" ? row.path : parentOf(row.path) : parentOf(tabDoc?.path ?? "");
    const targetDoc = row && row.type !== "directory" ? docs().find(item => item.path === row.path) : tabDoc;
    const treeOptions = [{
      title: "New file…",
      value: "new-file"
    }, {
      title: "New folder…",
      value: "new-folder"
    }, {
      title: "Rename…",
      value: "rename",
      disabled: !row
    }, {
      title: "Delete…",
      value: "delete",
      disabled: !row
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
    if (choice === "close-tab") {
      const at = targetDoc ? docs().findIndex(item => item.path === targetDoc.path && item.external === targetDoc.external) : active();
      if (at >= 0) closeDoc(at);
      return;
    }
    if (choice === "close-others") return closeMany("others");
    if (choice === "close-all") return closeMany("all");
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
        const row = rowProps.row;
        if (row.type === "directory") void toggleDirectory(row);else void openRow(row);
      });
      _$setProp(_el$14, "wrapMode", "none");
      _$setProp(_el$14, "selectable", false);
      _$setProp(_el$14, "flexShrink", 0);
      _$insert(_el$14, (() => {
        var _c$ = _$memo(() => rowProps.row.type === "directory");
        return () => _c$() ? isOpen() ? "▾ " : "▸ " : `${icon().glyph} `;
      })());
      _$setProp(_el$15, "wrapMode", "none");
      _$setProp(_el$15, "truncate", true);
      _$setProp(_el$15, "flexShrink", 0);
      _$insert(_el$15, (() => {
        var _c$2 = _$memo(() => rowProps.row.type === "hit");
        return () => _c$2() ? `${rowProps.row.path}:${rowProps.row.line}` : `${basename(rowProps.row.path)}${rowProps.row.type === "directory" ? "/" : ""}`;
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
      _el$32 = _$createElement("box"),
      _el$33 = _$createElement("box"),
      _el$34 = _$createElement("text"),
      _el$36 = _$createElement("text"),
      _el$37 = _$createTextNode(`[`),
      _el$38 = _$createTextNode(`]`),
      _el$39 = _$createElement("text"),
      _el$40 = _$createElement("box"),
      _el$41 = _$createElement("input"),
      _el$42 = _$createElement("scrollbox"),
      _el$77 = _$createElement("box"),
      _el$78 = _$createElement("text"),
      _el$79 = _$createElement("text");
    _$insertNode(_el$24, _el$25);
    _$insertNode(_el$24, _el$31);
    _$insertNode(_el$24, _el$77);
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
    _$insertNode(_el$31, _el$32);
    _$setProp(_el$31, "flexDirection", "row");
    _$setProp(_el$31, "flexGrow", 1);
    _$setProp(_el$31, "minHeight", 0);
    _$insertNode(_el$32, _el$33);
    _$insertNode(_el$32, _el$40);
    _$insertNode(_el$32, _el$42);
    _$setProp(_el$32, "flexShrink", 0);
    _$setProp(_el$32, "minHeight", 0);
    _$setProp(_el$32, "flexDirection", "column");
    _$insertNode(_el$33, _el$34);
    _$insertNode(_el$33, _el$36);
    _$insertNode(_el$33, _el$39);
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
    _$insertNode(_el$40, _el$41);
    _$setProp(_el$40, "height", 1);
    _$setProp(_el$40, "flexShrink", 0);
    _$setProp(_el$40, "paddingLeft", 1);
    _$setProp(_el$40, "paddingRight", 1);
    _$use(element => {
      searchInput = element;
      element.on("focus", () => setInputFocus(true));
      element.on("blur", () => setInputFocus(false));
    }, _el$41);
    _$setProp(_el$41, "onInput", value => scheduleSearch(value));
    _$setProp(_el$41, "on:focus", () => setInputFocus(true));
    _$setProp(_el$41, "on:blur", () => setInputFocus(false));
    _$setProp(_el$41, "onKeyDown", event => {
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
    _$use(element => listScroll = element, _el$42);
    _$setProp(_el$42, "flexGrow", 1);
    _$setProp(_el$42, "minHeight", 0);
    _$setProp(_el$42, "verticalScrollbarOptions", {
      visible: true
    });
    _$insert(_el$42, _$createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$43 = _$createElement("text");
        _$setProp(_el$43, "paddingLeft", 1);
        _$setProp(_el$43, "wrapMode", "word");
        _$insert(_el$43, error);
        _$effect(_$p => _$setProp(_el$43, "fg", theme.text.feedback.error.base, _$p));
        return _el$43;
      }
    }), null);
    _$insert(_el$42, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!loading())() && rows().length === 0;
      },
      get children() {
        var _el$44 = _$createElement("box"),
          _el$45 = _$createElement("text");
        _$insertNode(_el$44, _el$45);
        _$setProp(_el$44, "paddingLeft", 1);
        _$setProp(_el$45, "wrapMode", "none");
        _$insert(_el$45, () => query().trim() ? "No matches" : "(empty)");
        _$effect(_$p => _$setProp(_el$45, "fg", theme.text.muted, _$p));
        return _el$44;
      }
    }), null);
    _$insert(_el$42, _$createComponent(For, {
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
        var _el$46 = _$createElement("box"),
          _el$47 = _$createElement("text"),
          _el$48 = _$createElement("text");
        _$insertNode(_el$46, _el$47);
        _$insertNode(_el$46, _el$48);
        _$setProp(_el$46, "height", 1);
        _$setProp(_el$46, "flexShrink", 0);
        _$setProp(_el$46, "paddingLeft", 1);
        _$setProp(_el$46, "paddingRight", 1);
        _$setProp(_el$46, "flexDirection", "row");
        _$setProp(_el$46, "gap", 1);
        _$setProp(_el$47, "wrapMode", "none");
        _$setProp(_el$47, "truncate", true);
        _$setProp(_el$47, "flexGrow", 1);
        _$insert(_el$47, (() => {
          var _c$4 = _$memo(() => !!gitState().repo);
          return () => _c$4() ? `±${gitState().changes.length} changes` : "no repository";
        })());
        _$insertNode(_el$48, _$createTextNode(`ctrl+e`));
        _$setProp(_el$48, "wrapMode", "none");
        _$effect(_p$ => {
          var _v$15 = theme.text.muted,
            _v$16 = theme.text.muted;
          _v$15 !== _p$.e && (_p$.e = _$setProp(_el$47, "fg", _v$15, _p$.e));
          _v$16 !== _p$.t && (_p$.t = _$setProp(_el$48, "fg", _v$16, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$46;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return showEditor();
      },
      get children() {
        var _el$50 = _$createElement("box");
        _$setProp(_el$50, "flexGrow", 1);
        _$setProp(_el$50, "minWidth", 0);
        _$setProp(_el$50, "minHeight", 0);
        _$setProp(_el$50, "flexDirection", "column");
        _$insert(_el$50, _$createComponent(Show, {
          get when() {
            return _$memo(() => !!!simple())() && docs().length > 0;
          },
          get children() {
            var _el$51 = _$createElement("box"),
              _el$52 = _$createElement("text");
            _$insertNode(_el$51, _el$52);
            _$setProp(_el$51, "height", 1);
            _$setProp(_el$51, "flexShrink", 0);
            _$setProp(_el$51, "flexDirection", "row");
            _$setProp(_el$51, "overflow", "hidden");
            _$insert(_el$51, _$createComponent(For, {
              get each() {
                return docs();
              },
              children: (item, position) => _$createComponent(Tab, {
                item: item,
                get position() {
                  return position();
                }
              })
            }), _el$52);
            _$insertNode(_el$52, _$createTextNode(` `));
            _$setProp(_el$52, "flexGrow", 1);
            _$setProp(_el$52, "wrapMode", "none");
            _$effect(_$p => _$setProp(_el$52, "fg", theme.text.muted, _$p));
            return _el$51;
          }
        }), null);
        _$insert(_el$50, _$createComponent(Show, {
          get when() {
            return doc()?.path;
          },
          keyed: true,
          get fallback() {
            return (() => {
              var _el$82 = _$createElement("box"),
                _el$83 = _$createElement("text"),
                _el$84 = _$createElement("text");
              _$insertNode(_el$82, _el$83);
              _$insertNode(_el$82, _el$84);
              _$setProp(_el$82, "flexGrow", 1);
              _$setProp(_el$82, "minHeight", 0);
              _$setProp(_el$82, "flexDirection", "column");
              _$setProp(_el$82, "alignItems", "center");
              _$setProp(_el$82, "justifyContent", "center");
              _$setProp(_el$82, "gap", 1);
              _$insert(_el$83, () => simple() ? "File browser" : "OpenCode files");
              _$insert(_el$84, () => simple() || docked() ? "Select a file on the left and press Enter." : "Browse, edit and review without leaving the TUI.");
              _$insert(_el$82, _$createComponent(Show, {
                get when() {
                  return _$memo(() => !!docked())() && !simple();
                },
                get children() {
                  var _el$85 = _$createElement("text");
                  _$insertNode(_el$85, _$createTextNode(`tab pane · ctrl+f search · e edit · ctrl+s save`));
                  _$setProp(_el$85, "wrapMode", "word");
                  _$effect(_$p => _$setProp(_el$85, "fg", theme.text.muted, _$p));
                  return _el$85;
                }
              }), null);
              _$insert(_el$82, _$createComponent(Show, {
                get when() {
                  return _$memo(() => !!!simple())() && !docked();
                },
                get children() {
                  var _el$87 = _$createElement("box"),
                    _el$88 = _$createElement("text"),
                    _el$90 = _$createElement("box"),
                    _el$91 = _$createElement("text"),
                    _el$93 = _$createElement("text"),
                    _el$95 = _$createElement("box"),
                    _el$96 = _$createElement("text"),
                    _el$98 = _$createElement("text"),
                    _el$100 = _$createElement("box"),
                    _el$101 = _$createElement("text"),
                    _el$103 = _$createElement("text"),
                    _el$105 = _$createElement("box"),
                    _el$106 = _$createElement("text"),
                    _el$108 = _$createElement("text"),
                    _el$110 = _$createElement("box"),
                    _el$111 = _$createElement("text"),
                    _el$113 = _$createElement("text"),
                    _el$115 = _$createElement("box"),
                    _el$116 = _$createElement("text"),
                    _el$118 = _$createElement("text");
                  _$insertNode(_el$87, _el$88);
                  _$insertNode(_el$87, _el$90);
                  _$insertNode(_el$87, _el$95);
                  _$insertNode(_el$87, _el$100);
                  _$insertNode(_el$87, _el$105);
                  _$insertNode(_el$87, _el$110);
                  _$insertNode(_el$87, _el$115);
                  _$setProp(_el$87, "flexDirection", "column");
                  _$setProp(_el$87, "gap", 1);
                  _$setProp(_el$87, "paddingTop", 1);
                  _$setProp(_el$87, "border", true);
                  _$setProp(_el$87, "paddingLeft", 2);
                  _$setProp(_el$87, "paddingRight", 2);
                  _$insertNode(_el$88, _$createTextNode(`Quick start`));
                  _$insertNode(_el$90, _el$91);
                  _$insertNode(_el$90, _el$93);
                  _$setProp(_el$90, "flexDirection", "row");
                  _$setProp(_el$90, "gap", 2);
                  _$insertNode(_el$91, _$createTextNode(`↑ ↓ enter`));
                  _$setProp(_el$91, "wrapMode", "none");
                  _$setProp(_el$91, "width", 18);
                  _$insertNode(_el$93, _$createTextNode(`move and open`));
                  _$setProp(_el$93, "wrapMode", "none");
                  _$insertNode(_el$95, _el$96);
                  _$insertNode(_el$95, _el$98);
                  _$setProp(_el$95, "flexDirection", "row");
                  _$setProp(_el$95, "gap", 2);
                  _$insertNode(_el$96, _$createTextNode(`ctrl+f / ctrl+e`));
                  _$setProp(_el$96, "wrapMode", "none");
                  _$setProp(_el$96, "width", 18);
                  _$insertNode(_el$98, _$createTextNode(`search names or content`));
                  _$setProp(_el$98, "wrapMode", "none");
                  _$insertNode(_el$100, _el$101);
                  _$insertNode(_el$100, _el$103);
                  _$setProp(_el$100, "flexDirection", "row");
                  _$setProp(_el$100, "gap", 2);
                  _$insertNode(_el$101, _$createTextNode(`e / ctrl+s`));
                  _$setProp(_el$101, "wrapMode", "none");
                  _$setProp(_el$101, "width", 18);
                  _$insertNode(_el$103, _$createTextNode(`edit and save`));
                  _$setProp(_el$103, "wrapMode", "none");
                  _$insertNode(_el$105, _el$106);
                  _$insertNode(_el$105, _el$108);
                  _$setProp(_el$105, "flexDirection", "row");
                  _$setProp(_el$105, "gap", 2);
                  _$insertNode(_el$106, _$createTextNode(`ctrl+g`));
                  _$setProp(_el$106, "wrapMode", "none");
                  _$setProp(_el$106, "width", 18);
                  _$insertNode(_el$108, _$createTextNode(`git changes, stage and commit`));
                  _$setProp(_el$108, "wrapMode", "none");
                  _$insertNode(_el$110, _el$111);
                  _$insertNode(_el$110, _el$113);
                  _$setProp(_el$110, "flexDirection", "row");
                  _$setProp(_el$110, "gap", 2);
                  _$insertNode(_el$111, _$createTextNode(`F2`));
                  _$setProp(_el$111, "wrapMode", "none");
                  _$setProp(_el$111, "width", 18);
                  _$insertNode(_el$113, _$createTextNode(`preferences, including simple mode`));
                  _$setProp(_el$113, "wrapMode", "none");
                  _$insertNode(_el$115, _el$116);
                  _$insertNode(_el$115, _el$118);
                  _$setProp(_el$115, "flexDirection", "row");
                  _$setProp(_el$115, "gap", 2);
                  _$insertNode(_el$116, _$createTextNode(`F1`));
                  _$setProp(_el$116, "wrapMode", "none");
                  _$setProp(_el$116, "width", 18);
                  _$insertNode(_el$118, _$createTextNode(`every shortcut`));
                  _$setProp(_el$118, "wrapMode", "none");
                  _$effect(_p$ => {
                    var _v$53 = theme.border.base,
                      _v$54 = theme.text.action.primary.selected,
                      _v$55 = TextAttributes.BOLD,
                      _v$56 = theme.text.muted,
                      _v$57 = theme.text.base,
                      _v$58 = theme.text.muted,
                      _v$59 = theme.text.base,
                      _v$60 = theme.text.muted,
                      _v$61 = theme.text.base,
                      _v$62 = theme.text.muted,
                      _v$63 = theme.text.base,
                      _v$64 = theme.text.muted,
                      _v$65 = theme.text.base,
                      _v$66 = theme.text.muted,
                      _v$67 = theme.text.base;
                    _v$53 !== _p$.e && (_p$.e = _$setProp(_el$87, "borderColor", _v$53, _p$.e));
                    _v$54 !== _p$.t && (_p$.t = _$setProp(_el$88, "fg", _v$54, _p$.t));
                    _v$55 !== _p$.a && (_p$.a = _$setProp(_el$88, "attributes", _v$55, _p$.a));
                    _v$56 !== _p$.o && (_p$.o = _$setProp(_el$91, "fg", _v$56, _p$.o));
                    _v$57 !== _p$.i && (_p$.i = _$setProp(_el$93, "fg", _v$57, _p$.i));
                    _v$58 !== _p$.n && (_p$.n = _$setProp(_el$96, "fg", _v$58, _p$.n));
                    _v$59 !== _p$.s && (_p$.s = _$setProp(_el$98, "fg", _v$59, _p$.s));
                    _v$60 !== _p$.h && (_p$.h = _$setProp(_el$101, "fg", _v$60, _p$.h));
                    _v$61 !== _p$.r && (_p$.r = _$setProp(_el$103, "fg", _v$61, _p$.r));
                    _v$62 !== _p$.d && (_p$.d = _$setProp(_el$106, "fg", _v$62, _p$.d));
                    _v$63 !== _p$.l && (_p$.l = _$setProp(_el$108, "fg", _v$63, _p$.l));
                    _v$64 !== _p$.u && (_p$.u = _$setProp(_el$111, "fg", _v$64, _p$.u));
                    _v$65 !== _p$.c && (_p$.c = _$setProp(_el$113, "fg", _v$65, _p$.c));
                    _v$66 !== _p$.w && (_p$.w = _$setProp(_el$116, "fg", _v$66, _p$.w));
                    _v$67 !== _p$.m && (_p$.m = _$setProp(_el$118, "fg", _v$67, _p$.m));
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
                  return _el$87;
                }
              }), null);
              _$effect(_p$ => {
                var _v$68 = theme.text.base,
                  _v$69 = TextAttributes.BOLD,
                  _v$70 = theme.text.muted;
                _v$68 !== _p$.e && (_p$.e = _$setProp(_el$83, "fg", _v$68, _p$.e));
                _v$69 !== _p$.t && (_p$.t = _$setProp(_el$83, "attributes", _v$69, _p$.t));
                _v$70 !== _p$.a && (_p$.a = _$setProp(_el$84, "fg", _v$70, _p$.a));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$82;
            })();
          },
          get children() {
            return _$createComponent(ErrorBoundary, {
              fallback: cause => (() => {
                var _el$120 = _$createElement("box"),
                  _el$121 = _$createElement("text"),
                  _el$122 = _$createTextNode(`Could not render this file: `);
                _$insertNode(_el$120, _el$121);
                _$setProp(_el$120, "flexGrow", 1);
                _$setProp(_el$120, "padding", 1);
                _$insertNode(_el$121, _el$122);
                _$setProp(_el$121, "wrapMode", "word");
                _$insert(_el$121, () => message(cause), null);
                _$effect(_$p => _$setProp(_el$121, "fg", theme.text.feedback.error.base, _$p));
                return _el$120;
              })(),
              get children() {
                var _el$54 = _$createElement("box");
                _$setProp(_el$54, "flexGrow", 1);
                _$setProp(_el$54, "minHeight", 0);
                _$setProp(_el$54, "flexDirection", "column");
                _$insert(_el$54, _$createComponent(EditorView, {
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
                  onText: text => updateDoc(doc(), text),
                  onSave: () => void save(),
                  onCursor: () => {},
                  onLeave: () => setFocus("explorer"),
                  onKey: editorKey,
                  onToggleMode: toggleEdit,
                  onReady: api => editorApi = api
                }));
                return _el$54;
              }
            });
          }
        }), null);
        _$effect(_$p => _$setProp(_el$50, "backgroundColor", surface(), _$p));
        return _el$50;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return showChanges();
      },
      get children() {
        var _el$55 = _$createElement("box"),
          _el$56 = _$createElement("box"),
          _el$57 = _$createElement("text"),
          _el$59 = _$createElement("text"),
          _el$60 = _$createElement("text"),
          _el$61 = _$createTextNode(` staged`),
          _el$62 = _$createElement("scrollbox"),
          _el$67 = _$createElement("box"),
          _el$68 = _$createElement("text"),
          _el$70 = _$createElement("text"),
          _el$72 = _$createElement("text"),
          _el$74 = _$createElement("text");
        _$insertNode(_el$55, _el$56);
        _$insertNode(_el$55, _el$62);
        _$insertNode(_el$55, _el$67);
        _$setProp(_el$55, "width", 30);
        _$setProp(_el$55, "flexShrink", 0);
        _$setProp(_el$55, "minHeight", 0);
        _$setProp(_el$55, "flexDirection", "column");
        _$setProp(_el$55, "border", true);
        _$insertNode(_el$56, _el$57);
        _$insertNode(_el$56, _el$59);
        _$insertNode(_el$56, _el$60);
        _$setProp(_el$56, "height", 1);
        _$setProp(_el$56, "flexShrink", 0);
        _$setProp(_el$56, "paddingLeft", 1);
        _$setProp(_el$56, "paddingRight", 1);
        _$setProp(_el$56, "flexDirection", "row");
        _$setProp(_el$56, "gap", 1);
        _$insertNode(_el$57, _$createTextNode(`CHANGES`));
        _$setProp(_el$57, "wrapMode", "none");
        _$setProp(_el$59, "wrapMode", "none");
        _$setProp(_el$59, "flexGrow", 1);
        _$insert(_el$59, () => gitState().changes.length);
        _$insertNode(_el$60, _el$61);
        _$setProp(_el$60, "wrapMode", "none");
        _$insert(_el$60, () => gitState().staged, _el$61);
        _$setProp(_el$62, "flexGrow", 1);
        _$setProp(_el$62, "minHeight", 0);
        _$setProp(_el$62, "verticalScrollbarOptions", {
          visible: true
        });
        _$insert(_el$62, _$createComponent(Show, {
          get when() {
            return gitState().changes.length === 0;
          },
          get children() {
            var _el$63 = _$createElement("text");
            _$insertNode(_el$63, _$createTextNode(`No changes`));
            _$setProp(_el$63, "paddingLeft", 1);
            _$effect(_$p => _$setProp(_el$63, "fg", theme.text.muted, _$p));
            return _el$63;
          }
        }), null);
        _$insert(_el$62, _$createComponent(For, {
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
        _$insert(_el$55, _$createComponent(Show, {
          get when() {
            return composing();
          },
          get children() {
            var _el$65 = _$createElement("box"),
              _el$66 = _$createElement("input");
            _$insertNode(_el$65, _el$66);
            _$setProp(_el$65, "height", 1);
            _$setProp(_el$65, "flexShrink", 0);
            _$setProp(_el$65, "paddingLeft", 1);
            _$setProp(_el$65, "paddingRight", 1);
            _$use(element => {
              commitInput = element;
              setTimeout(() => {
                try {
                  element.focus();
                } catch {}
              }, 20);
            }, _el$66);
            _$setProp(_el$66, "placeholder", "Commit message…");
            _$setProp(_el$66, "focused", true);
            _$setProp(_el$66, "onInput", value => setCommitMessage(value));
            _$setProp(_el$66, "onKeyDown", event => {
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
              var _v$17 = commitMessage(),
                _v$18 = surface(),
                _v$19 = theme.text.base,
                _v$20 = theme.text.base;
              _v$17 !== _p$.e && (_p$.e = _$setProp(_el$66, "value", _v$17, _p$.e));
              _v$18 !== _p$.t && (_p$.t = _$setProp(_el$66, "backgroundColor", _v$18, _p$.t));
              _v$19 !== _p$.a && (_p$.a = _$setProp(_el$66, "textColor", _v$19, _p$.a));
              _v$20 !== _p$.o && (_p$.o = _$setProp(_el$66, "focusedTextColor", _v$20, _p$.o));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            return _el$65;
          }
        }), _el$67);
        _$insertNode(_el$67, _el$68);
        _$insertNode(_el$67, _el$70);
        _$insertNode(_el$67, _el$72);
        _$insertNode(_el$67, _el$74);
        _$setProp(_el$67, "flexShrink", 0);
        _$setProp(_el$67, "flexDirection", "column");
        _$setProp(_el$67, "paddingLeft", 1);
        _$setProp(_el$67, "paddingRight", 1);
        _$insertNode(_el$68, _$createTextNode(`a stage · u unstage`));
        _$setProp(_el$68, "wrapMode", "none");
        _$insertNode(_el$70, _$createTextNode(`d discard · c commit`));
        _$setProp(_el$70, "wrapMode", "none");
        _$insertNode(_el$72, _$createTextNode(`l pull · p push`));
        _$setProp(_el$72, "wrapMode", "none");
        _$insertNode(_el$74, _$createTextNode(`g history · b branch · R`));
        _$setProp(_el$74, "wrapMode", "none");
        _$effect(_p$ => {
          var _v$21 = focus() === "changes" ? theme.border.base : theme.background.raised.base,
            _v$22 = surface(),
            _v$23 = theme.text.base,
            _v$24 = TextAttributes.BOLD,
            _v$25 = theme.text.muted,
            _v$26 = theme.text.muted,
            _v$27 = theme.text.muted,
            _v$28 = theme.text.muted,
            _v$29 = theme.text.muted,
            _v$30 = theme.text.muted;
          _v$21 !== _p$.e && (_p$.e = _$setProp(_el$55, "borderColor", _v$21, _p$.e));
          _v$22 !== _p$.t && (_p$.t = _$setProp(_el$55, "backgroundColor", _v$22, _p$.t));
          _v$23 !== _p$.a && (_p$.a = _$setProp(_el$57, "fg", _v$23, _p$.a));
          _v$24 !== _p$.o && (_p$.o = _$setProp(_el$57, "attributes", _v$24, _p$.o));
          _v$25 !== _p$.i && (_p$.i = _$setProp(_el$59, "fg", _v$25, _p$.i));
          _v$26 !== _p$.n && (_p$.n = _$setProp(_el$60, "fg", _v$26, _p$.n));
          _v$27 !== _p$.s && (_p$.s = _$setProp(_el$68, "fg", _v$27, _p$.s));
          _v$28 !== _p$.h && (_p$.h = _$setProp(_el$70, "fg", _v$28, _p$.h));
          _v$29 !== _p$.r && (_p$.r = _$setProp(_el$72, "fg", _v$29, _p$.r));
          _v$30 !== _p$.d && (_p$.d = _$setProp(_el$74, "fg", _v$30, _p$.d));
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
        return _el$55;
      }
    }), null);
    _$insert(_el$31, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!docked())() && options().mouse;
      },
      get children() {
        var _el$76 = _$createElement("box");
        _$setProp(_el$76, "width", 1);
        _$setProp(_el$76, "flexShrink", 0);
        _$setProp(_el$76, "onMouseDown", event => {
          if (event.button !== MouseButton.LEFT) return;
          event.stopPropagation();
          setDrag({
            active: true,
            width: explorerWidth()
          });
        });
        _$setProp(_el$76, "onMouseDrag", event => {
          if (!drag().active) return;
          event.stopPropagation();
          setSplitWidth(Math.max(18, Math.min(60, drag().width + event.deltaX)));
        });
        _$setProp(_el$76, "onMouseUp", () => setDrag({
          active: false,
          width: 0
        }));
        _$effect(_$p => _$setProp(_el$76, "backgroundColor", drag().active ? theme.border.base : surface(), _$p));
        return _el$76;
      }
    }), null);
    _$insertNode(_el$77, _el$78);
    _$insertNode(_el$77, _el$79);
    _$setProp(_el$77, "height", 1);
    _$setProp(_el$77, "flexShrink", 0);
    _$setProp(_el$77, "paddingRight", 2);
    _$setProp(_el$77, "flexDirection", "row");
    _$setProp(_el$77, "gap", 1);
    _$setProp(_el$78, "wrapMode", "none");
    _$setProp(_el$78, "truncate", true);
    _$setProp(_el$78, "flexGrow", 1);
    _$insert(_el$78, () => status() ?? (typing() ? "typing · ctrl+s save · ctrl+←/→ tabs · esc leaves · F4 preview · F1 help" : focus() === "changes" ? "a stage · u unstage · d discard · c commit · l pull · p push · g history · b branches" : focus() === "editor" ? "e edit · ctrl+s save · ctrl+w close · ctrl+←/→ tabs · m markdown · F1 help" : "↑↓ move · enter open · → expand · ← collapse · tab pane · ctrl+f search · ctrl+e mode · F2 prefs · F1 help"));
    _$setProp(_el$79, "wrapMode", "none");
    _$insert(_el$79, (() => {
      var _c$5 = _$memo(() => !!simple());
      return () => _c$5() ? "simple" : `${docs().length} tabs`;
    })());
    _$insert(_el$77, _$createComponent(Show, {
      get when() {
        return props.panel;
      },
      get children() {
        var _el$80 = _$createElement("text");
        _$insertNode(_el$80, _$createTextNode(`f fullscreen`));
        _$setProp(_el$80, "wrapMode", "none");
        _$effect(_$p => _$setProp(_el$80, "fg", theme.text.muted, _$p));
        return _el$80;
      }
    }), null);
    _$effect(_p$ => {
      var _v$31 = surface(),
        _v$32 = docked() ? 2 : 1,
        _v$33 = theme.text.base,
        _v$34 = TextAttributes.BOLD,
        _v$35 = theme.text.muted,
        _v$36 = theme.text.muted,
        _v$37 = explorerWidth(),
        _v$38 = surface(),
        _v$39 = !docked(),
        _v$40 = focus() === "explorer" ? theme.border.base : theme.background.raised.base,
        _v$41 = theme.text.base,
        _v$42 = TextAttributes.BOLD,
        _v$43 = theme.text.muted,
        _v$44 = theme.text.muted,
        _v$45 = query(),
        _v$46 = searchMode() === "name" ? "Search files…" : "Search content…",
        _v$47 = surface(),
        _v$48 = theme.text.base,
        _v$49 = theme.text.base,
        _v$50 = docked() ? 2 : 1,
        _v$51 = theme.text.muted,
        _v$52 = theme.text.muted;
      _v$31 !== _p$.e && (_p$.e = _$setProp(_el$24, "backgroundColor", _v$31, _p$.e));
      _v$32 !== _p$.t && (_p$.t = _$setProp(_el$25, "paddingLeft", _v$32, _p$.t));
      _v$33 !== _p$.a && (_p$.a = _$setProp(_el$26, "fg", _v$33, _p$.a));
      _v$34 !== _p$.o && (_p$.o = _$setProp(_el$26, "attributes", _v$34, _p$.o));
      _v$35 !== _p$.i && (_p$.i = _$setProp(_el$28, "fg", _v$35, _p$.i));
      _v$36 !== _p$.n && (_p$.n = _$setProp(_el$30, "fg", _v$36, _p$.n));
      _v$37 !== _p$.s && (_p$.s = _$setProp(_el$32, "width", _v$37, _p$.s));
      _v$38 !== _p$.h && (_p$.h = _$setProp(_el$32, "backgroundColor", _v$38, _p$.h));
      _v$39 !== _p$.r && (_p$.r = _$setProp(_el$32, "border", _v$39, _p$.r));
      _v$40 !== _p$.d && (_p$.d = _$setProp(_el$32, "borderColor", _v$40, _p$.d));
      _v$41 !== _p$.l && (_p$.l = _$setProp(_el$34, "fg", _v$41, _p$.l));
      _v$42 !== _p$.u && (_p$.u = _$setProp(_el$34, "attributes", _v$42, _p$.u));
      _v$43 !== _p$.c && (_p$.c = _$setProp(_el$36, "fg", _v$43, _p$.c));
      _v$44 !== _p$.w && (_p$.w = _$setProp(_el$39, "fg", _v$44, _p$.w));
      _v$45 !== _p$.m && (_p$.m = _$setProp(_el$41, "value", _v$45, _p$.m));
      _v$46 !== _p$.f && (_p$.f = _$setProp(_el$41, "placeholder", _v$46, _p$.f));
      _v$47 !== _p$.y && (_p$.y = _$setProp(_el$41, "backgroundColor", _v$47, _p$.y));
      _v$48 !== _p$.g && (_p$.g = _$setProp(_el$41, "textColor", _v$48, _p$.g));
      _v$49 !== _p$.p && (_p$.p = _$setProp(_el$41, "focusedTextColor", _v$49, _p$.p));
      _v$50 !== _p$.b && (_p$.b = _$setProp(_el$77, "paddingLeft", _v$50, _p$.b));
      _v$51 !== _p$.T && (_p$.T = _$setProp(_el$78, "fg", _v$51, _p$.T));
      _v$52 !== _p$.A && (_p$.A = _$setProp(_el$79, "fg", _v$52, _p$.A));
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