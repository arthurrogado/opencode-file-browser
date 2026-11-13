import type { LocationRef } from "@opencode/client"
import type { PanelInput, Route } from "@opencode/plugin/tui/context"
import type { Plugin } from "@opencode/plugin/tui"
import { MouseButton, SyntaxStyle, TextAttributes, type ScrollBoxRenderable, type InputRenderable, type RGBA } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { ErrorBoundary, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import path from "node:path"
import { mkdir, readFile, rename as renameFile, rm, stat, writeFile } from "node:fs/promises"
import {
  HEAVY_CHARS,
  HEAVY_LINES,
  MAX_CHARS,
  MAX_LINES,
  OVERSIZE_BYTES,
  OVERSIZE_LINES,
  basename,
  clampLongLines,
  expandHome,
  filetype,
  formatBytes,
  isBinary,
  isMarkdown,
  message,
  parentOf,
  type Entry,
} from "./lib/util.js"
import { useSettings, type Settings } from "./lib/settings.js"
import { searchContent, type ContentHit } from "./lib/search.js"
import * as git from "./lib/git.js"
import { EditorView, isDirty, type Doc } from "./ui/editor.js"
import { SettingsDialog } from "./ui/settings.js"

export const ROUTE = "file-browser"

type Controller = {
  readonly commands: () => any[]
  readonly changes: () => any[]
  readonly keys: () => any[]
  readonly enabled: () => boolean
  readonly changesEnabled: () => boolean
  readonly typing: () => boolean
}

const [controller, setController] = createSignal<Controller>()

/**
 * Keymap layers are registered once for the plugin lifetime. The route and the
 * panel mount/unmount freely (and remount on host re-renders), so binding the
 * layers to a component instance made them disappear under heavy files.
 */
export function registerBrowserLayers(context: Plugin.Context) {
  context.keymap.layer(() => {
    const current = controller()
    return {
      priority: 105,
      enabled: () => !!current && current.enabled(),
      commands: current?.keys() ?? [],
    }
  })
  context.keymap.layer(() => {
    const current = controller()
    return {
      priority: 100,
      enabled: () => !!current && current.enabled() && !current.typing(),
      commands: current?.commands() ?? [],
    }
  })
  context.keymap.layer(() => {
    const current = controller()
    return {
      priority: 110,
      enabled: () => !!current && current.changesEnabled(),
      commands: current?.changes() ?? [],
    }
  })
}

type Row = {
  readonly path: string
  readonly type: "file" | "directory" | "hit"
  readonly depth: number
  readonly line?: number
  readonly preview?: string
  /** The synthetic ".." entry of navigate mode. */
  readonly parent?: boolean
}

const iconFor = (row: Row, theme: Plugin.Context["theme"]) => {
  if (row.type === "directory") return { glyph: "▸", color: theme.text.action.secondary.base }
  if (row.type === "hit") return { glyph: "·", color: theme.text.muted }
  const name = basename(row.path)
  if (isMarkdown(name)) return { glyph: "◆", color: theme.markdown.link }
  const ext = name.toLowerCase()
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return { glyph: "◆", color: theme.syntax.function }
  if (/\.(json|jsonc|ya?ml|toml|ini)$/.test(ext)) return { glyph: "◆", color: theme.syntax.number }
  if (/\.(sh|bash|zsh)$/.test(ext)) return { glyph: "◆", color: theme.syntax.string }
  if (/\.(md|markdown|mdx)$/.test(ext)) return { glyph: "◆", color: theme.markdown.link }
  return { glyph: "·", color: theme.text.muted }
}

const CHANGE_LETTER: Record<string, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "?",
  conflicted: "U",
}

export function Browser(props: {
  context: Plugin.Context
  location: () => LocationRef
  panel?: PanelInput
  onClose: () => void
}) {
  const context = props.context
  const theme = context.theme
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const settings = useSettings(context)
  const options = () => settings.value()

  const syntax = createSyntaxStyle(theme, renderer.nativeScene)
  // Destroy only when this component unmounts. renderer.idle() resolves after
  // the next idle frame, not at teardown.
  onCleanup(() => {
    void renderer.idle?.()?.then(() => syntax.destroy())
  })

  const [docs, setDocs] = createSignal<Doc[]>([])
  const [active, setActive] = createSignal(-1)
  const [modes, setModes] = createSignal<Record<string, boolean>>({})
  const [previews, setPreviews] = createSignal<Record<string, boolean>>({})
  const [focus, setFocus] = createSignal<"explorer" | "editor" | "changes">("explorer")
  const [index, setIndex] = createSignal(0)
  const [dirs, setDirs] = createSignal<Record<string, Entry[]>>({})
  const [expanded, setExpanded] = createSignal<readonly string[]>([])
  const [navRoot, setNavRoot] = createSignal("")
  const [externalChange, setExternalChange] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [searchMode, setSearchMode] = createSignal<"name" | "content">(options().search)
  const [hits, setHits] = createSignal<ContentHit[]>([])
  const [hitsTruncated, setHitsTruncated] = createSignal(false)
  const [searching, setSearching] = createSignal(false)
  const [found, setFound] = createSignal<string[]>([])
  const [gitState, setGitState] = createSignal<git.GitState>({ repo: false, branch: "", changes: [], staged: 0, unstaged: 0 })
  const [changeIndex, setChangeIndex] = createSignal(0)
  const [commitMessage, setCommitMessage] = createSignal("")
  const [composing, setComposing] = createSignal(false)
  const [inputFocus, setInputFocus] = createSignal(false)
  const [status, setStatus] = createSignal<string>()
  const [pendingLine, setPendingLine] = createSignal(0)
  const [drag, setDrag] = createSignal<{ active: boolean; width: number }>({ active: false, width: 0 })
  const [splitWidth, setSplitWidth] = createSignal(0)
  let searchInput: InputRenderable | undefined
  let commitInput: InputRenderable | undefined
  let editorApi: { newline: () => void } | undefined

  // Tabs survive a trip to the chat: the panel unmounts when the session view
  // takes over, so the documents live in the host's in-memory store.
  const [stored, updateStored] = context.storage.memory<{
    root?: string
    docs?: Doc[]
    active?: number
    modes?: Record<string, boolean>
    previews?: Record<string, boolean>
    navRoot?: string
  }>("browser", { initial: {} })
  const restored = { ...stored }
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const snapshot = {
      root: props.location().directory,
      docs: docs(),
      active: active(),
      modes: modes(),
      previews: previews(),
      navRoot: navRoot(),
    }
    if (!snapshot.docs.length) return
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      void updateStored((draft) => {
        Object.assign(draft, snapshot)
      })
    }, 250)
  })

  const docked = () => props.panel !== undefined && props.panel.presentation === "panel"
  const simple = () => options().simple
  const width = () => (docked() ? (props.panel?.width ?? dimensions().width) : dimensions().width)
  const explorerWidth = () => {
    const custom = splitWidth()
    if (custom) return custom
    return Math.max(18, Math.min(46, Math.floor(width() * 0.28)))
  }
  const showChanges = () => !simple() && !docked() && options().changes && gitState().repo && width() >= 130
  const showEditor = () => !docked() || options().panelPreview
  const surface = () => (docked() ? theme.background.raised.base : theme.background.base)

  const doc = () => docs()[active()]
  const isEditing = () => {
    const current = doc()
    return current ? !!modes()[current.path] : false
  }
  const showMarkdown = () => {
    const current = doc()
    return current ? previews()[current.path] ?? true : true
  }

  // While the textarea owns the keyboard every global letter binding would eat
  // the user's keystrokes; only the handlers attached to the textarea itself
  // (escape, tab, ctrl+s, ctrl+w, ctrl+arrows) stay live.
  const typing = () => focus() === "editor" && isEditing() && !showMarkdown()

  // Ask the renderables themselves: the focus/blur events of the host input
  // are not reliable when a panel remounts, and a stuck flag would swallow
  // every global key (escape included).
  const inputFocused = () =>
    !!(searchInput && !searchInput.isDestroyed && searchInput.focused) ||
    !!(commitInput && !commitInput.isDestroyed && commitInput.focused)

  const navigate = () => options().tree === "navigate"

  const rows = createMemo<Row[]>(() => {
    const name = query().trim()
    const fold = (value: string) => (options().caseSensitive ? value : value.toLowerCase())
    const needle = fold(name)
    if (name && searchMode() === "name") {
      if (name.length >= 2 && found().length > 0) {
        return found().map((value) => ({ path: value, type: "file" as const, depth: 0 }))
      }
      return listing().filter((row) => fold(row.path).includes(needle))
    }
    if (searchMode() === "content" && name.length >= 2) {
      return hits().map((hit) => ({
        path: hit.path,
        type: "hit" as const,
        depth: 1,
        line: hit.line,
        preview: hit.text,
      }))
    }
    return listing()
  })

  function listing() {
    if (!navigate()) return flatten(dirs(), expanded())
    const root = navRoot()
    const rows: Row[] = (dirs()[root] ?? []).map((entry) => ({ path: entry.path, type: entry.type as "file" | "directory", depth: 0 }))
    return root ? [{ path: "..", type: "directory" as const, depth: 0, parent: true }, ...rows] : rows
  }

  function flatten(cache: Record<string, Entry[]>, open: readonly string[], root = "", depth = 0, output: Row[] = []) {
    const entries = cache[root]
    if (!entries) return output
    for (const entry of entries) {
      output.push({ path: entry.path, type: entry.type, depth })
      if (entry.type === "directory" && open.includes(entry.path)) {
        flatten(cache, open, entry.path, depth + 1, output)
      }
    }
    return output
  }

  const currentRow = () => rows()[index()]

  function setCache(path: string, entries: Entry[]) {
    setDirs((cache) => ({ ...cache, [path]: entries }))
  }

  async function loadDirectory(target: string) {
    const result = await context.client.file.list({
      location: props.location(),
      path: target || undefined,
    })
    const items = result.data
      .filter((entry) => options().hidden || !basename(entry.path).startsWith("."))
      .map((entry) => ({ path: entry.path.replace(/\/+$/, ""), type: entry.type }))
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === "directory" ? -1 : 1
        return basename(left.path).localeCompare(basename(right.path), undefined, { sensitivity: "base" })
      })
    setCache(target, items)
    return items
  }

  async function enterDirectory(target: string) {
    setLoading(true)
    try {
      if (!dirs()[target]) await loadDirectory(target)
      setNavRoot(target)
      setIndex(0)
    } catch (cause) {
      // Keep the previous listing: a failed load must never leave an empty
      // screen that looks frozen.
      setStatus(`Could not open ${target}: ${message(cause)}`)
    } finally {
      setLoading(false)
    }
  }

  async function goUp(root = false) {
    if (!navRoot()) return false
    await enterDirectory(root ? "" : parentOf(navRoot()))
    return true
  }

  async function toggleDirectory(row: Row) {
    if (expanded().includes(row.path)) {
      setExpanded((open) => open.filter((value) => value !== row.path && !value.startsWith(`${row.path}/`)))
      return
    }
    setLoading(true)
    try {
      if (!dirs()[row.path]) await loadDirectory(row.path)
      setExpanded((open) => [...open, row.path])
    } catch (cause) {
      setStatus(`Could not open ${row.path}: ${message(cause)}`)
    } finally {
      setLoading(false)
    }
  }

  function collapseAll() {
    if (navigate()) {
      void goUp(true)
      return
    }
    setExpanded([])
    setIndex(0)
  }

  async function refreshTree() {
    const open = expanded()
    const loaded = Object.keys(dirs()).filter(Boolean)
    setDirs({})
    try {
      await loadDirectory("")
      for (const directory of loaded) {
        await loadDirectory(directory).catch(() => undefined)
      }
      setExpanded(open)
      if (navigate() && navRoot()) await loadDirectory(navRoot()).catch(() => undefined)
    } catch (cause) {
      setError(message(cause))
    }
  }

  async function loadFile(target: string, external: boolean) {
    const bytes = external
      ? new Uint8Array(await readFile(target))
      : await context.client.file.read({ location: props.location(), path: target })
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBufferLike)
    if (isBinary(data)) return { binary: true as const, oversize: false as const, size: data.length }
    let text = new TextDecoder("utf-8").decode(data)
    if (data.length > OVERSIZE_BYTES) {
      const lines = (text.match(/\n/g)?.length ?? 0) + 1
      return { binary: false as const, oversize: true as const, lines, size: data.length }
    }
    let truncated = false
    let lineCount = 0
    let cut = -1
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) !== 10) continue
      lineCount++
      if (lineCount === MAX_LINES) cut = index
    }
    if (lineCount + 1 > OVERSIZE_LINES) {
      return { binary: false as const, oversize: true as const, lines: lineCount + 1, size: data.length }
    }
    if (cut >= 0) {
      text = text.slice(0, cut)
      truncated = true
    }
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS)
      truncated = true
    }
    const clamped = clampLongLines(text)
    text = clamped.text
    truncated = truncated || clamped.clipped
    const readOnly = data.length > HEAVY_CHARS || lineCount > HEAVY_LINES || truncated
    return { binary: false as const, oversize: false as const, text, truncated, readOnly, size: data.length }
  }

  async function openDoc(target: string, external: boolean, line?: number) {
    const existing = docs().findIndex((item) => item.path === target && item.external === external)
    if (existing >= 0) {
      setActive(existing)
      setPendingLine(line ?? 0)
      if (line) setStatus(`line ${line}`)
      return
    }
    try {
      const loaded = await loadFile(target, external)
      if (loaded.binary) {
        setStatus(`${basename(target)} is binary (${formatBytes(loaded.size)})`)
        return
      }
      if (loaded.oversize) {
        const next: Doc = {
          path: target,
          external,
          text: "",
          original: "",
          type: filetype(target),
          markdown: false,
          truncated: true,
          readOnly: true,
          oversize: true,
          lines: loaded.lines,
        }
        setDocs((list) => [...list, next])
        setActive(docs().length - 1)
        setModes((value) => ({ ...value, [target]: false }))
        setPreviews((value) => ({ ...value, [target]: false }))
        setFocus("editor")
        setStatus(`${basename(target)} is too large to render (${loaded.lines ?? "many"} lines, ${formatBytes(loaded.size)})`)
        return
      }
      const { text, truncated, readOnly } = loaded
      const next: Doc = {
        path: target,
        external,
        text,
        original: text,
        type: filetype(target),
        markdown: isMarkdown(target),
        truncated,
        readOnly,
      }
      setDocs((list) => [...list, next])
      setActive(docs().length - 1)
      setModes((value) => ({ ...value, [target]: !next.markdown && !readOnly }))
      setPreviews((value) => ({ ...value, [target]: next.markdown }))
      setFocus("editor")
      setPendingLine(line ?? 0)
      if (readOnly) setStatus(`${basename(target)} is large; opened read-only (${formatBytes(loaded.size)})`)
      if (line) setStatus(`line ${line}`)
    } catch (cause) {
      setStatus(`Could not open ${basename(target)}: ${message(cause)}`)
    }
  }

  function relativeToLocation(target: string) {
    const relative = path.relative(props.location().directory, target)
    if (!relative) return ""
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return relative
  }

  async function openByPath(input: string) {
    const value = input.trim()
    if (!value) return
    const base = props.location().directory
    const target = path.resolve(base, expandHome(value))
    const relative = relativeToLocation(target)
    const info = await stat(target).catch(() => undefined)
    if (info?.isDirectory()) {
      if (relative === undefined) {
        setStatus("That directory is outside the project.")
        return
      }
      setSearchMode("name")
      setQuery("")
      await toggleDirectory({ path: relative, type: "directory", depth: 0 })
      return
    }
    if (!info) {
      setStatus(`Not found: ${target}`)
      return
    }
    await openDoc(relative ?? target, relative === undefined)
  }

  async function openDiff(change: git.GitChange) {
    const path = `diff:${change.path}`
    const existing = docs().findIndex((item) => item.path === path)
    if (existing >= 0) {
      setActive(existing)
      setFocus("editor")
      return
    }
    try {
      let text = ""
      if (change.status === "untracked") {
        const content = await readFile(absolute(change.path), "utf8")
        const lines = content.split("\n")
        text = `--- /dev/null\n+++ b/${change.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`
      } else {
        const args = change.staged ? ["diff", "--cached", "--", change.path] : ["diff", "--", change.path]
        const result = await git.git(props.location().directory, args)
        text = result.stdout
      }
      if (!text.trim()) text = "No textual changes."
      const next: Doc = {
        path,
        external: false,
        text,
        original: text,
        type: filetype(change.path),
        markdown: false,
        truncated: false,
        readOnly: true,
        diff: true,
        rawPath: change.path,
      }
      setDocs((list) => [...list, next])
      setActive(docs().length - 1)
      setModes((value) => ({ ...value, [path]: false }))
      setPreviews((value) => ({ ...value, [path]: false }))
      setFocus("editor")
    } catch (cause) {
      setStatus(`Could not diff ${change.path}: ${message(cause)}`)
    }
  }

  async function openRow(row: Row) {
    if (row.parent) {
      await goUp()
      return
    }
    if (row.type === "directory") {
      if (navigate()) await enterDirectory(row.path)
      else await toggleDirectory(row)
      return
    }
    if (row.type === "hit") {
      await openDoc(row.path, false, row.line)
      return
    }
    if (row.path.endsWith("/")) await toggleDirectory(row)
    else await openDoc(row.path, false)
  }

  function closeDoc(at: number) {
    const target = docs()[at]
    if (!target) return
    const drop = () => {
      const next = docs().filter((_, position) => position !== at)
      const nextActive = Math.max(0, Math.min(next.length - 1, active() >= at ? active() - 1 : active()))
      setDocs(next)
      setActive(nextActive)
    }
    if (!isDirty(target)) {
      drop()
      return
    }
    if (!options().confirmDiscard) {
      drop()
      return
    }
    void context.ui.dialog
      .select<"save" | "discard" | "cancel">({
        title: `Close ${basename(target.path)}?`,
        options: [
          { title: "Save and close", value: "save" },
          { title: "Close without saving", value: "discard" },
          { title: "Cancel", value: "cancel" },
        ],
      })
      .then(async (choice) => {
        if (choice === "discard") drop()
        if (choice === "save") {
          await save(target)
          drop()
        }
      })
  }

  function updateDoc(target: Doc, text: string) {
    setDocs((list) =>
      list.map((item) => (item.path === target.path && item.external === target.external ? { ...item, text } : item)),
    )
  }

  async function save(target = doc()) {
    if (!target) return
    if (target.readOnly) {
      setStatus("This file is read-only here; open it in an external editor.")
      return
    }
    const current = docs().find((item) => item.path === target.path && item.external === target.external)
    if (!current) return
    try {
      const disk = await (current.external
        ? readFile(current.path).then((bytes) => new TextDecoder("utf-8").decode(bytes))
        : context.client.file
            .read({ location: props.location(), path: current.path })
            .then((bytes) => new TextDecoder("utf-8").decode(bytes as Uint8Array)))
      if (disk !== current.original) {
        const overwrite = await context.ui.dialog.confirm({
          title: "File changed on disk",
          message: `${basename(current.path)} changed outside the editor. Overwrite it with your version?`,
          label: { confirm: "Overwrite", cancel: "Keep disk" },
        })
        if (!overwrite) {
          setStatus("Save cancelled; reload the file to see the disk version.")
          return
        }
      }
      const payload = new TextEncoder().encode(current.text)
      if (current.external) await writeFile(current.path, payload)
      else await context.client.experimental.file.write({ location: props.location(), path: current.path, payload })
      setDocs((list) =>
        list.map((item) =>
          item.path === current.path && item.external === current.external ? { ...item, original: current.text } : item,
        ),
      )
      setStatus(`Saved ${basename(current.path)}`)
      void refreshGit()
    } catch (cause) {
      setStatus(`Save failed: ${message(cause)}`)
      context.ui.toast.show({ variant: "error", message: `Save failed: ${message(cause)}` })
    }
  }

  async function refreshGit() {
    if (simple()) return
    try {
      setGitState(await git.status(props.location().directory))
    } catch (cause) {
      setGitState({ repo: false, branch: "", changes: [], staged: 0, unstaged: 0, error: message(cause) })
    }
  }

  async function runGitAction(action: "stage" | "unstage" | "discard" | "commit" | "pull" | "push") {
    const root = props.location().directory
    const change = gitState().changes[changeIndex()]
    try {
      if (action === "stage") await git.stage(root, change?.path)
      if (action === "unstage") await git.unstage(root, change?.path)
      if (action === "discard" && change) {
        if (options().confirmDiscard) {
          const ok = await context.ui.dialog.confirm({
            title: "Discard changes",
            message: `Throw away local changes in ${change.path}? This cannot be undone.`,
            label: { confirm: "Discard", cancel: "Cancel" },
          })
          if (!ok) return
        }
        await git.discard(root, change)
      }
      if (action === "commit") {
        const text = commitMessage().trim()
        if (!text) {
          setStatus("Write a commit message first.")
          return
        }
        const result = await git.commit(root, text)
        if (!result.ok) {
          setStatus(result.stderr.trim() || result.stdout.trim() || "Commit failed")
          return
        }
        setCommitMessage("")
        setStatus("Committed")
        context.ui.toast.show({ variant: "success", message: "Commit created" })
      }
      if (action === "pull" || action === "push") {
        const result = action === "pull" ? await git.pull(root) : await git.push(root)
        const last = `${result.stdout}${result.stderr}`.trim().split("\n").filter(Boolean).pop() ?? ""
        setStatus(last || `${action} finished`)
        context.ui.toast.show({ variant: result.ok ? "success" : "error", message: last || `${action} finished` })
      }
      await refreshGit()
    } catch (cause) {
      setStatus(`${action} failed: ${message(cause)}`)
    }
  }

  async function showHistory() {
    const lines = await git.log(props.location().directory)
    await context.ui.dialog.alert({ title: "Recent commits", message: lines.join("\n") || "No commits" })
  }

  async function showBranches() {
    const list = await git.branches(props.location().directory)
    await context.ui.dialog.alert({ title: "Branches", message: list.join("\n") || "No branches" })
  }

  function toggleEdit() {
    const current = doc()
    if (!current) return
    if (current.diff) {
      if (current.rawPath) void openDoc(current.rawPath, false)
      return
    }
    if (current.readOnly) {
      setStatus("Large file: read-only preview.")
      return
    }
    if (isEditing()) {
      setModes((value) => ({ ...value, [current.path]: false }))
      if (current.markdown) setPreviews((value) => ({ ...value, [current.path]: true }))
      return
    }
    setModes((value) => ({ ...value, [current.path]: true }))
    setPreviews((value) => ({ ...value, [current.path]: false }))
    setFocus("editor")
  }

  function toggleMarkdown() {
    const current = doc()
    if (!current?.markdown) return
    setModes((value) => ({ ...value, [current.path]: false }))
    setPreviews((value) => ({ ...value, [current.path]: !(value[current.path] ?? true) }))
  }

  function moveSelection(delta: number) {
    if (focus() === "explorer") {
      const total = rows().length
      if (!total) return
      setIndex((value) => Math.max(0, Math.min(total - 1, value + delta)))
      return
    }
    if (focus() === "changes") {
      const total = gitState().changes.length
      if (!total) return
      setChangeIndex((value) => Math.max(0, Math.min(total - 1, value + delta)))
      return
    }
    if (isEditing() && !showMarkdown()) return
  }

  function pageSelection(direction: -1 | 1) {
    const size = Math.max(1, Math.floor(dimensions().height / 2))
    moveSelection(direction * size)
  }

  async function doSearch(value: string) {
    setQuery(value)
    setIndex(0)
    if (searchMode() === "name") {
      if (value.trim().length < 2) {
        setFound([])
        return
      }
      try {
        const result = await context.client.file.find({ location: props.location(), query: value.trim(), limit: 200 })
        setFound(
          result.data
            .filter((entry) => entry.type === "file")
            .filter((entry) => !options().caseSensitive || entry.path.includes(value.trim()))
            .map((entry) => entry.path),
        )
      } catch {
        setFound([])
      }
      return
    }
    if (value.trim().length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    try {
      const result = await searchContent(props.location().directory, value, options().caseSensitive)
      if (value !== query()) return
      setHits([...result.hits])
      setHitsTruncated(result.truncated)
      if (result.error) setStatus(result.error)
    } finally {
      setSearching(false)
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleSearch(value: string) {
    setQuery(value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void doSearch(value), 220)
  }

  function toggleSearchMode() {
    setSearchMode((value) => (value === "name" ? "content" : "name"))
    setHits([])
    setFound([])
    setQuery("")
    setIndex(0)
    focusSearch()
  }

  function focusSearch() {
    setFocus("explorer")
    setInputFocus(true)
    if (searchInput && !searchInput.isDestroyed) {
      searchInput.focus()
      return
    }
    setTimeout(() => {
      try {
        searchInput?.focus()
      } catch {}
    }, 30)
  }

  function focusCommit() {
    setComposing(true)
    setTimeout(() => {
      try {
        commitInput?.focus()
      } catch {}
    }, 30)
  }

  function openSettings() {
    context.ui.dialog.set({ size: "large" })
    context.ui.dialog.show(
      () => (
        <SettingsDialog
          context={context}
          value={settings.value()}
          onChange={(mutation) => void settings.update(mutation)}
          onClose={() => context.ui.dialog.clear()}
        />
      ),
      () => {},
    )
  }

  function showHelp() {
    context.ui.dialog.set({ size: "large" })
    context.ui.dialog.show(() => (
      <box flexDirection="column" padding={1} gap={0} width={78}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Keyboard shortcuts
        </text>
        <scrollbox height={22} flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
          <For each={helpRows()}>
            {(row) => (
              <box flexDirection="row" height={1}>
                <box width={18} flexShrink={0}>
                  <text fg={theme.text.action.primary.selected} wrapMode="none">
                    {row.keys}
                  </text>
                </box>
                <text fg={theme.text.base} wrapMode="none" truncate>
                  {row.title}
                </text>
              </box>
            )}
          </For>
        </scrollbox>
        <text fg={theme.text.muted} wrapMode="none">
          ↑↓ scroll · esc close · every command is also in ctrl+p
        </text>
      </box>
    ))
  }

  const helpRows = () => [
    { keys: "^X F", title: "Open or close the file browser" },
    { keys: "^X O", title: "Open a file by path" },
    { keys: "^P", title: "Command palette (all actions live there)" },
    { keys: "↑ ↓ / j k", title: "Move in the list" },
    { keys: "→ / enter", title: "Open file or expand folder" },
    { keys: "← / shift+enter", title: "Collapse folder" },
    { keys: "tab", title: "Cycle explorer / editor / changes" },
    { keys: "^F", title: "Focus search" },
    { keys: "^E", title: "Switch name / content search" },
    { keys: "^S", title: "Save the current file" },
    { keys: "^W", title: "Close the current tab" },
    { keys: "^← ^→", title: "Previous / next tab" },
    { keys: "e", title: "Toggle preview / editor" },
    { keys: "m", title: "Toggle rendered Markdown" },
    { keys: "ctrl+g", title: "Focus the changes panel" },
    { keys: "F1", title: "This help" },
    { keys: "F2", title: "Preferences" },
    { keys: "F3", title: "Focus the changes panel" },
    { keys: "F4", title: "Toggle preview / editor" },
    { keys: "f", title: "Toggle fullscreen (docked panel)" },
    { keys: "r", title: "Reload tree, file and git status" },
    { keys: "h", title: "Toggle hidden files" },
  ]

  const absolute = (relative: string) => path.join(props.location().directory, relative)

  async function refreshDirectory(relative: string) {
    await loadDirectory(relative).catch(() => undefined)
    if (!navigate() && relative && !expanded().includes(relative)) setExpanded((open) => [...open, relative])
  }

  function dropDocs(predicate: (item: Doc) => boolean) {
    const next = docs().filter((item) => !predicate(item))
    setDocs(next)
    setActive((value) => Math.max(0, Math.min(next.length - 1, value)))
  }

  async function closeMany(mode: "others" | "all") {
    const keep = mode === "others" ? docs()[active()] : undefined
    const targets = docs().filter((item) => item !== keep)
    if (!targets.length) return
    const dirty = targets.filter(isDirty)
    if (dirty.length && options().confirmDiscard) {
      const ok = await context.ui.dialog.confirm({
        title: "Close tabs",
        message: `${dirty.length} unsaved ${dirty.length === 1 ? "file" : "files"} will lose changes.`,
        label: { confirm: "Close", cancel: "Cancel" },
      })
      if (!ok) return
    }
    setDocs(keep ? [keep] : [])
    setActive(keep ? 0 : -1)
  }

  async function openContext(kind: "tree" | "tab", target?: Row | Doc) {
    const row = kind === "tree" ? (target as Row | undefined) : undefined
    const tabDoc = kind === "tab" ? (target as Doc | undefined) ?? doc() : doc()
    const base = row ? (row.type === "directory" ? row.path : parentOf(row.path)) : parentOf(tabDoc?.path ?? "")
    const targetDoc = row && row.type !== "directory" ? docs().find((item) => item.path === row.path) : tabDoc
    const treeOptions = [
      { title: "New file…", value: "new-file" },
      { title: "New folder…", value: "new-folder" },
      { title: "Rename…", value: "rename", disabled: !row },
      { title: "Delete…", value: "delete", disabled: !row },
      { title: `Close tab${targetDoc ? ` (${basename(targetDoc.path)})` : ""}`, value: "close-tab", disabled: !targetDoc },
      { title: "Close other tabs", value: "close-others" },
      { title: "Close all tabs", value: "close-all" },
    ]
    const tabOptions = [
      { title: `Close (${tabDoc ? basename(tabDoc.path) : "tab"})`, value: "close-tab" },
      { title: "Close other tabs", value: "close-others" },
      { title: "Close all tabs", value: "close-all" },
    ]
    const choice = await context.ui.dialog.select<string>({
      title: kind === "tree" ? `Actions · ${row ? basename(row.path) : "project"}` : "Tab actions",
      options: kind === "tree" ? treeOptions : tabOptions,
    })
    if (!choice) return

    if (choice === "close-tab") {
      const at = targetDoc ? docs().findIndex((item) => item.path === targetDoc.path && item.external === targetDoc.external) : active()
      if (at >= 0) closeDoc(at)
      return
    }
    if (choice === "close-others") return closeMany("others")
    if (choice === "close-all") return closeMany("all")

    if (choice === "new-file" || choice === "new-folder") {
      const name = await context.ui.dialog.prompt({
        title: choice === "new-file" ? "New file" : "New folder",
        description: base ? `inside ${base}/` : "inside the project root",
        placeholder: choice === "new-file" ? "notes.md" : "folder",
      })
      const clean = name?.trim().replace(/^\.?\//, "")
      if (!clean) return
      const relative = base ? `${base}/${clean}` : clean
      try {
        if (choice === "new-file") await writeFile(absolute(relative), "")
        else await mkdir(absolute(relative), { recursive: true })
        await refreshDirectory(base)
        setStatus(`Created ${relative}`)
        if (choice === "new-file") await openDoc(relative, false)
      } catch (cause) {
        setStatus(`Could not create ${relative}: ${message(cause)}`)
      }
      return
    }

    if (!row) return
    if (choice === "rename") {
      const name = await context.ui.dialog.prompt({ title: "Rename", value: basename(row.path), description: row.path })
      const clean = name?.trim()
      if (!clean || clean === basename(row.path)) return
      const next = parentOf(row.path) ? `${parentOf(row.path)}/${clean}` : clean
      try {
        await renameFile(absolute(row.path), absolute(next))
        dropDocs((item) => item.path === row.path || item.path.startsWith(`${row.path}/`))
        await refreshDirectory(parentOf(row.path))
        setStatus(`Renamed to ${next}`)
      } catch (cause) {
        setStatus(`Rename failed: ${message(cause)}`)
      }
      return
    }
    if (choice === "delete") {
      const ok = await context.ui.dialog.confirm({
        title: "Delete",
        message: `Delete ${row.path}${row.type === "directory" ? " and everything inside it" : ""}?`,
        label: { confirm: "Delete", cancel: "Cancel" },
      })
      if (!ok) return
      try {
        await rm(absolute(row.path), { recursive: true, force: true })
        dropDocs((item) => item.path === row.path || item.path.startsWith(`${row.path}/`) || item.rawPath === row.path)
        await refreshDirectory(parentOf(row.path))
        setStatus(`Deleted ${row.path}`)
      } catch (cause) {
        setStatus(`Delete failed: ${message(cause)}`)
      }
    }
  }

  const commands: any[] = [
    {
      id: "file-browser.escape",
      title: "Leave editor / clear search / close",
      group: "Files",
      bind: "escape",
      enabled: () => !inputFocused() && !composing(),
      run: () => {
        if (focus() !== "explorer") {
          setFocus("explorer")
          return
        }
        if (query().trim().length > 0) {
          scheduleSearch("")
          setHits([])
          setFound([])
          setIndex(0)
          return
        }
        void requestClose()
      },
    },
    { id: "file-browser.close", title: "Close file browser", group: "Files", bind: "q", enabled: () => !inputFocused() && !composing(), run: () => void requestClose() },
    { id: "file-browser.down", title: "Next item", group: "Files", bind: "down,j", enabled: () => !inputFocused() && !composing(), run: () => moveSelection(1) },
    { id: "file-browser.up", title: "Previous item", group: "Files", bind: "up,k", enabled: () => !inputFocused() && !composing(), run: () => moveSelection(-1) },
    {
      id: "file-browser.select",
      title: "Open selected item",
      group: "Files",
      bind: "return",
      enabled: () => !inputFocused() && !composing(),
      run: () => {
        const row = currentRow()
        if (row && focus() === "explorer") void openRow(row)
      },
    },
    { id: "file-browser.select.space", title: "Open selected item", group: "Files", bind: "space", enabled: () => !inputFocused() && !composing() && focus() === "explorer", run: () => { const row = currentRow(); if (row) void openRow(row) } },
    { id: "file-browser.parent", title: "Collapse folder / go up", group: "Files", bind: "left,backspace", enabled: () => !inputFocused() && !composing(), run: () => {
      if (navigate()) {
        if (navRoot()) void goUp()
        return
      }
      const row = currentRow()
      if (row?.type === "directory" && expanded().includes(row.path)) void toggleDirectory(row)
    } },
    { id: "file-browser.expand", title: "Expand folder", group: "Files", bind: "right", enabled: () => !inputFocused() && !composing(), run: () => { const row = currentRow(); if (row?.type === "directory" && !expanded().includes(row.path)) void toggleDirectory(row) } },
    { id: "file-browser.collapse", title: "Collapse folder tree", group: "Files", bind: "shift+enter", enabled: () => !inputFocused() && !composing(), run: collapseAll },
    { id: "file-browser.page_down", title: "Page down", group: "Files", bind: "pagedown", enabled: () => !inputFocused() && !composing(), run: () => pageSelection(1) },
    { id: "file-browser.page_up", title: "Page up", group: "Files", bind: "pageup", enabled: () => !inputFocused() && !composing(), run: () => pageSelection(-1) },
    { id: "file-browser.first", title: "Go to start", group: "Files", bind: "home", enabled: () => !inputFocused() && !composing(), run: () => setIndex(0) },
    { id: "file-browser.last", title: "Go to end", group: "Files", bind: "end", enabled: () => !inputFocused() && !composing(), run: () => setIndex(Math.max(0, rows().length - 1)) },
    { id: "file-browser.focus", title: "Cycle panes", group: "Files", bind: "tab", enabled: () => !inputFocused() && !composing(), run: cycleFocus },
    { id: "file-browser.search", title: "Search files", group: "Files", bind: "ctrl+f,/", enabled: () => !composing(), run: focusSearch },
    { id: "file-browser.search.mode", title: "Toggle name/content search", group: "Files", bind: "ctrl+e", enabled: () => !composing(), run: toggleSearchMode },
    { id: "file-browser.save", title: "Save file", group: "Files", bind: "ctrl+s", enabled: () => !composing() && !!doc(), run: () => void save() },
    { id: "file-browser.tab.close", title: "Close tab", group: "Files", bind: "ctrl+w", enabled: () => !inputFocused() && !composing(), run: () => closeDoc(active()) },
    { id: "file-browser.tab.next", title: "Next tab", group: "Files", bind: "ctrl+pagedown,ctrl+right", enabled: () => !inputFocused() && !composing(), run: () => setActive((value) => Math.min(docs().length - 1, value + 1)) },
    { id: "file-browser.tab.prev", title: "Previous tab", group: "Files", bind: "ctrl+pageup,ctrl+left", enabled: () => !inputFocused() && !composing(), run: () => setActive((value) => Math.max(0, value - 1)) },
    { id: "file-browser.edit", title: "Toggle preview/editor", group: "Files", bind: "e", enabled: () => !inputFocused() && !composing(), run: toggleEdit },
    { id: "file-browser.markdown", title: "Toggle Markdown/source", group: "Files", bind: "m", enabled: () => !inputFocused() && !composing(), run: toggleMarkdown },
    { id: "file-browser.reload", title: "Reload", group: "Files", bind: "r", enabled: () => !inputFocused() && !composing(), run: () => void refresh() },
    { id: "file-browser.hidden", title: "Toggle hidden files", group: "Files", bind: "h", enabled: () => !inputFocused() && !composing(), run: () => void settings.update((draft) => { draft.hidden = !draft.hidden }).then(refreshTree) },
    { id: "file-browser.path", title: "Open file by path", group: "Files", bind: "o", enabled: () => !inputFocused() && !composing(), run: () => void promptPath() },
    { id: "file-browser.fullscreen", title: "Toggle fullscreen", group: "Files", bind: "f", enabled: () => !inputFocused() && !composing(), run: toggleFullscreen },
    {
      id: "file-browser.changes.focus",
      title: "Focus changes",
      group: "Git",
      bind: "ctrl+g",
      enabled: () => !inputFocused() && !composing() && showChanges(),
      run: () => {
        setFocus("changes")
        void refreshGit()
      },
    },
  ]

  const changesCommands: any[] = [
    {
      id: "file-browser.git.open",
      title: "Open the diff for this change",
      group: "Git",
      bind: "return,space",
      enabled: () => !composing() && focus() === "changes",
      run: () => {
        const change = gitState().changes[changeIndex()]
        if (change) void openDiff(change)
      },
    },
    { id: "file-browser.git.stage", title: "Stage change", group: "Git", bind: "a", enabled: () => !composing() && focus() === "changes", run: () => void runGitAction("stage") },
    { id: "file-browser.git.stage_all", title: "Stage all changes", group: "Git", bind: "shift+a", enabled: () => !composing() && focus() === "changes", run: () => void git.stage(props.location().directory).then(refreshGit) },
    { id: "file-browser.git.unstage", title: "Unstage change", group: "Git", bind: "u", enabled: () => !composing() && focus() === "changes", run: () => void runGitAction("unstage") },
    { id: "file-browser.git.discard", title: "Discard change", group: "Git", bind: "d", enabled: () => !composing() && focus() === "changes", run: () => void runGitAction("discard") },
    { id: "file-browser.git.commit", title: "Commit staged changes", group: "Git", bind: "c", enabled: () => !composing() && focus() === "changes", run: focusCommit },
    { id: "file-browser.git.pull", title: "Pull", group: "Git", bind: "l", enabled: () => !composing() && focus() === "changes", run: () => void runGitAction("pull") },
    { id: "file-browser.git.push", title: "Push", group: "Git", bind: "p", enabled: () => !composing() && focus() === "changes", run: () => void runGitAction("push") },
    { id: "file-browser.git.branches", title: "Branches", group: "Git", bind: "b", enabled: () => !composing() && focus() === "changes", run: () => void showBranches() },
    { id: "file-browser.git.history", title: "History", group: "Git", bind: "g", enabled: () => !composing() && focus() === "changes", run: () => void showHistory() },
    { id: "file-browser.git.refresh", title: "Refresh git status", group: "Git", bind: "shift+r", enabled: () => !composing() && focus() === "changes", run: () => void refreshGit() },
  ]

  const keyCommands: any[] = [
      { id: "file-browser.keys.help", title: "Keyboard shortcuts", group: "Files", bind: "f1", run: showHelp },
      { id: "file-browser.keys.settings", title: "Preferences", group: "Files", bind: "f2", run: openSettings },
      {
        id: "file-browser.keys.changes",
        title: "Focus changes",
        group: "Git",
        bind: "f3",
        enabled: () => showChanges(),
        run: () => {
          setFocus("changes")
          void refreshGit()
        },
      },
      { id: "file-browser.keys.edit", title: "Toggle preview/editor", group: "Files", bind: "f4", run: toggleEdit },
      {
        id: "file-browser.keys.explorer",
        title: "Focus the explorer",
        group: "Files",
        bind: "shift+tab",
        enabled: () => !composing(),
        run: () => setFocus("explorer"),
      },
      {
        id: "file-browser.keys.actions",
        title: "Item actions (new, rename, delete, close tabs)",
        group: "Files",
        bind: "f10",
        run: () => {
          if (focus() === "changes") return
          if (focus() === "editor" && doc()) void openContext("tab", doc())
          else void openContext("tree", currentRow())
        },
      },
      { id: "file-browser.keys.refresh", title: "Refresh", group: "Files", bind: "f5", run: () => void refresh() },
      {
        id: "file-browser.keys.changes2",
        title: "Focus changes",
        group: "Git",
        bind: "ctrl+g",
        enabled: () => showChanges(),
        run: () => {
          setFocus("changes")
          void refreshGit()
        },
      },
      {
        id: "file-browser.keys.newline",
        title: "Insert a new line in the editor",
        group: "Files",
        bind: "return,shift+return",
        enabled: () => typing(),
        run: () => editorApi?.newline(),
      },
  ]

  const instance: Controller = {
    commands: () => commands,
    changes: () => changesCommands,
    keys: () => keyCommands,
    enabled: () => (props.panel ? props.panel.focused : true),
    changesEnabled: () => (props.panel ? props.panel.focused : true) && !composing() && focus() === "changes" && !typing(),
    typing: () => typing(),
  }
  setController(instance)
  onCleanup(() => {
    if (controller() === instance) setController(undefined)
  })

  async function promptPath() {
    const value = await context.ui.dialog.prompt({
      title: "Open file by path",
      description: "Absolute path, or relative to the project. ~ points to your home.",
      placeholder: "/path/to/file or ../notes.md",
    })
    if (value) await openByPath(value)
  }

  function toggleFullscreen() {
    const panel = props.panel
    if (!panel) return
    panel.toggleFullscreen()
  }

  function cycleFocus() {
    setFocus((value) =>
      value === "explorer" ? (showEditor() ? "editor" : "explorer") : value === "editor" ? (showChanges() ? "changes" : "explorer") : "explorer",
    )
  }

  function editorKey(event: any) {
    const key = String(event.name ?? event.key ?? "").toLowerCase()
    const ctrl = !!(event.ctrl || event.meta)
    if (key === "escape") {
      setFocus("explorer")
      return true
    }
    if (key === "tab") {
      cycleFocus()
      return true
    }
    if (ctrl && key === "s") {
      void save()
      return true
    }
    if (ctrl && key === "w") {
      closeDoc(active())
      return true
    }
    if (ctrl && key === "left") {
      setActive((value) => Math.max(0, value - 1))
      return true
    }
    if (ctrl && key === "right") {
      setActive((value) => Math.min(docs().length - 1, value + 1))
      return true
    }
    return false
  }

  async function refresh() {
    const current = doc()
    if (current && isDirty(current)) {
      if (!externalChange()) {
        setStatus("Save or discard your edits before reloading.")
        await refreshGit()
        return
      }
      const ok = await context.ui.dialog.confirm({
        title: "Reload from disk",
        message: "Your unsaved edits will be discarded.",
        label: { confirm: "Reload", cancel: "Cancel" },
      })
      if (!ok) return
    }
    setExternalChange(false)
    await refreshTree()
    if (current) {
      try {
        const loaded = await loadFile(current.path, current.external)
        if (!loaded.binary && !loaded.oversize) {
          setDocs((list) =>
            list.map((item) =>
              item.path === current.path && item.external === current.external
                ? { ...item, text: loaded.text, original: loaded.text, truncated: loaded.truncated, readOnly: loaded.readOnly }
                : item,
            ),
          )
        }
      } catch (cause) {
        setStatus(`Could not reload ${basename(current.path)}: ${message(cause)}`)
      }
    }
    await refreshGit()
  }

  async function requestClose() {
    const dirty = docs().filter(isDirty)
    if (!dirty.length) {
      props.onClose()
      return
    }
    const choice = await context.ui.dialog.select<"save" | "discard" | "cancel">({
      title: `Close the browser? ${dirty.length} unsaved ${dirty.length === 1 ? "file" : "files"}`,
      options: [
        { title: "Save all and close", value: "save" },
        { title: "Close without saving", value: "discard" },
        { title: "Cancel", value: "cancel" },
      ],
    })
    if (choice === "cancel" || !choice) return
    if (choice === "save") {
      for (const item of dirty) await save(item)
      if (docs().some(isDirty)) return
    }
    props.onClose()
  }

  const [pending, updatePending] = context.storage.memory<{ path?: string; seq: number }>("pending", {
    initial: { seq: 0 },
  })
  const [action, updateAction] = context.storage.memory<{ name?: string; seq: number }>("action", {
    initial: { seq: 0 },
  })
  let lastAction = 0
  createEffect(() => {
    const seq = action.seq
    if (!seq || seq === lastAction) return
    lastAction = seq
    const name = action.name
    void updateAction((draft) => {
      draft.name = undefined
    })
    if (!name) return
    if (name === "settings") openSettings()
    if (name === "help") showHelp()
    if (name === "close") void requestClose()
    if (name === "refresh") void refresh()
    if (name === "changes") {
      setFocus("changes")
      void refreshGit()
    }
    if (name === "stage") void git.stage(props.location().directory).then(refreshGit)
    if (name === "hidden") void settings.update((draft) => ((draft.hidden = !draft.hidden), undefined)).then(refreshTree)
    if (name === "lineNumbers") void settings.update((draft) => ((draft.lineNumbers = !draft.lineNumbers), undefined))
    if (name === "simple") void settings.update((draft) => ((draft.simple = !draft.simple), undefined))
  })
  createEffect(() => {
    const request = pending.path
    if (!request) return
    void updatePending((draft) => {
      draft.path = undefined
    })
    void openByPath(request)
  })

  let lastRoot: string | undefined
  createEffect(() => {
    const root = props.location().directory
    if (root === lastRoot) return
    lastRoot = root
    setStatus(undefined)
    setQuery("")
    setHits([])
    setFound([])
    if (restored.root === root && restored.docs?.length) {
      setDocs(restored.docs)
      setActive(Math.min(restored.active ?? 0, restored.docs.length - 1))
      setModes(restored.modes ?? {})
      setPreviews(restored.previews ?? {})
      setNavRoot(restored.navRoot ?? "")
    } else {
      setDocs([])
      setActive(-1)
      setNavRoot("")
    }
    void refreshTree()
    void refreshGit()
  })

  // Switching between in-place expansion and navigate mode starts from the
  // project root so the list never shows stale rows.
  let lastTree: string | undefined
  createEffect(() => {
    const mode = options().tree
    if (mode === lastTree) return
    lastTree = mode
    setNavRoot("")
    setExpanded([])
    setIndex(0)
  })

  // Keep focus on a pane that exists when simple mode hides the git panel.
  createEffect(() => {
    if (!showChanges() && focus() === "changes") setFocus("editor")
  })

  // Keep the selected row visible.
  let listScroll: ScrollBoxRenderable | undefined
  createEffect(() => {
    if (focus() !== "explorer" && searchInput && !searchInput.isDestroyed) {
      try {
        searchInput.blur()
      } catch {}
    }
  })
  createEffect(() => {
    const selected = index()
    if (!rows().length) return
    const scroll = listScroll
    if (!scroll || scroll.isDestroyed) return
    if (selected < scroll.scrollTop) scroll.scrollTo(selected)
    else if (selected + 1 > scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(selected + 1 - scroll.viewport.height)
  })

  const headerCount = () => {
    if (searchMode() === "content" && query().trim().length >= 2) return `${hits().length}${hitsTruncated() ? "+" : ""} hits`
    if (searchMode() === "name" && query().trim().length >= 2) return `${rows().length} matches`
    return `${rows().filter((row) => row.depth === 0).length} items`
  }

  const branch = () => (gitState().repo ? gitState().branch : "")

  const tabLabel = (item: Doc) =>
    `${isDirty(item) ? "● " : ""}${item.diff ? "Δ " : ""}${basename(item.rawPath ?? item.path)}`

  const Tab = (tabProps: { item: Doc; position: number }) => {
    const [hovered, setHovered] = createSignal(false)
    return (
      <box
        flexDirection="row"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={
          tabProps.position === active()
            ? theme.background.raised.max
            : hovered()
              ? theme.background.raised.high
              : surface()
        }
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event: any) => {
          if (!options().mouse) return
          if (event.button === MouseButton.RIGHT) {
            event.stopPropagation()
            setActive(tabProps.position)
            void openContext("tab", tabProps.item)
            return
          }
          if (event.button === MouseButton.MIDDLE) {
            event.stopPropagation()
            closeDoc(tabProps.position)
            return
          }
          if (event.button !== MouseButton.LEFT) return
          event.stopPropagation()
          setActive(tabProps.position)
          setFocus("editor")
        }}
      >
        <text
          fg={tabProps.position === active() ? theme.text.action.primary.selected : theme.text.muted}
          wrapMode="none"
          attributes={tabProps.position === active() ? TextAttributes.BOLD : 0}
        >
          {tabLabel(tabProps.item)}
        </text>
        <text
          fg={theme.text.muted}
          wrapMode="none"
          paddingLeft={1}
          onMouseUp={(event: any) => {
            if (!options().mouse || event.button !== MouseButton.LEFT) return
            event.stopPropagation()
            closeDoc(tabProps.position)
          }}
        >
          ×
        </text>
      </box>
    )
  }

  const RowView = (rowProps: { row: Row; position: number }) => {
    const [hovered, setHovered] = createSignal(false)
    const icon = () => iconFor(rowProps.row, theme)
    const isOpen = () => rowProps.row.type === "directory" && expanded().includes(rowProps.row.path)
    return (
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1 + rowProps.row.depth * 2}
        paddingRight={1}
        backgroundColor={
          rowProps.position === index() && focus() === "explorer"
            ? theme.background.raised.max
            : hovered()
              ? theme.background.raised.high
              : surface()
        }
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event: any) => {
          if (!options().mouse) return
          if (event.button === MouseButton.RIGHT) {
            event.stopPropagation()
            setFocus("explorer")
            setIndex(rowProps.position)
            void openContext("tree", rowProps.row)
            return
          }
          if (event.button !== MouseButton.LEFT) return
          event.stopPropagation()
          setFocus("explorer")
          setIndex(rowProps.position)
          const row = rowProps.row
          if (row.type === "directory") void toggleDirectory(row)
          else void openRow(row)
        }}
      >
        <text fg={icon().color} wrapMode="none" selectable={false} flexShrink={0}>
          {rowProps.row.parent ? "↰ " : rowProps.row.type === "directory" ? (isOpen() ? "▾ " : "▸ ") : `${icon().glyph} `}
        </text>
        <text
          fg={
            rowProps.position === index() && focus() === "explorer"
              ? theme.text.action.primary.selected
              : rowProps.row.type === "directory"
                ? theme.text.action.secondary.base
                : theme.text.base
          }
          wrapMode="none"
          truncate
          flexShrink={0}
        >
          {rowProps.row.parent
            ? ".."
            : rowProps.row.type === "hit"
              ? `${rowProps.row.path}:${rowProps.row.line}`
              : `${basename(rowProps.row.path)}${rowProps.row.type === "directory" ? "/" : ""}`}
        </text>
        <Show when={rowProps.row.type === "hit"}>
          <box paddingLeft={1} minWidth={0} flexGrow={1}>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {rowProps.row.preview}
            </text>
          </box>
        </Show>
      </box>
    )
  }

  const ChangeRow = (changeProps: { change: git.GitChange; position: number }) => (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        changeProps.position === changeIndex() && focus() === "changes"
          ? theme.background.raised.max
          : hoveredChange() === changeProps.position
            ? theme.background.raised.high
            : surface()
      }
      onMouseOver={() => setHoveredChange(changeProps.position)}
      onMouseOut={() => setHoveredChange(-1)}
      onMouseUp={(event: any) => {
        if (!options().mouse || event.button !== MouseButton.LEFT) return
        event.stopPropagation()
        setFocus("changes")
        setChangeIndex(changeProps.position)
        void openDiff(changeProps.change)
      }}
    >
      <text
        fg={
          changeProps.change.status === "deleted"
            ? theme.text.feedback.error.base
            : changeProps.change.status === "added" || changeProps.change.status === "untracked"
              ? theme.text.feedback.success.base
              : theme.text.feedback.warning.base
        }
        wrapMode="none"
      >
        {CHANGE_LETTER[changeProps.change.status] ?? "M"}{" "}
      </text>
      <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1}>
        {changeProps.change.path}
      </text>
      <Show when={changeProps.change.staged}>
        <text fg={theme.text.muted} wrapMode="none">
          staged
        </text>
      </Show>
    </box>
  )
  const [hoveredChange, setHoveredChange] = createSignal(-1)

  const contentWidth = () => width() - explorerWidth() - (showChanges() ? 34 : 0)

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={surface()}>
      {/* Header */}
      <box height={1} flexShrink={0} paddingLeft={docked() ? 2 : 1} paddingRight={2} flexDirection="row" gap={1}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          files
        </text>
        <text
          fg={theme.text.muted}
          wrapMode="none"
          truncate
          flexGrow={1}
          minWidth={0}
          onMouseUp={(event: any) => {
            if (!options().mouse || event.button !== MouseButton.LEFT) return
            if (!navigate() || !navRoot()) return
            event.stopPropagation?.()
            void goUp()
          }}
        >
          {context.ui.format.path(props.location().directory)}
          {navRoot() ? `/${navRoot()}` : ""}
        </text>
        <Show when={branch()}>
          <text fg={theme.text.muted} wrapMode="none">
            {branch()}
          </text>
        </Show>
        <text fg={theme.text.muted} wrapMode="none">
          {headerCount()}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0}>
        {/* Explorer */}
        <box
          width={explorerWidth()}
          flexShrink={0}
          minHeight={0}
          flexDirection="column"
          backgroundColor={surface()}
          border={!docked()}
          borderColor={focus() === "explorer" ? theme.border.base : theme.background.raised.base}
        >
          <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
              Explorer
            </text>
            <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1}>
              [{searchMode() === "name" ? "names" : "content"}]
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              {loading() || searching() ? "…" : ""}
            </text>
          </box>
          <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
            <input
              ref={(element: InputRenderable) => {
                searchInput = element
                element.on("focus", () => setInputFocus(true))
                element.on("blur", () => setInputFocus(false))
              }}
              value={query()}
              placeholder={searchMode() === "name" ? "Search files…" : "Search content…"}
              backgroundColor={surface()}
              textColor={theme.text.base}
              focusedTextColor={theme.text.base}
              onInput={(value: string) => scheduleSearch(value)}
              on:focus={() => setInputFocus(true)}
              on:blur={() => setInputFocus(false)}
              onKeyDown={(event: any) => {
                const key = String(event.name ?? event.key ?? "").toLowerCase()
                if (key === "escape") {
                  scheduleSearch("")
                  setInputFocus(false)
                  try {
                    searchInput?.blur()
                  } catch {}
                  return
                }
                if (key === "down") {
                  event.preventDefault?.()
                  moveSelection(1)
                  return
                }
                if (key === "up") {
                  event.preventDefault?.()
                  moveSelection(-1)
                  return
                }
                if (key === "pagedown") {
                  event.preventDefault?.()
                  pageSelection(1)
                  return
                }
                if (key === "pageup") {
                  event.preventDefault?.()
                  pageSelection(-1)
                  return
                }
                if (key === "return") {
                  const row = currentRow()
                  if (!row) return
                  event.preventDefault?.()
                  try {
                    searchInput?.blur()
                  } catch {}
                  void openRow(row)
                }
              }}
            />
          </box>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (listScroll = element)}
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: true }}
          >
            <Show when={error()}>
              <text fg={theme.text.feedback.error.base} paddingLeft={1} wrapMode="word">
                {error()}
              </text>
            </Show>
            <Show when={!loading() && rows().length === 0}>
              <box paddingLeft={1}>
                <text fg={theme.text.muted} wrapMode="none">
                  {query().trim() ? "No matches" : navigate() && navRoot() ? "empty folder · ← or .. to go up" : "(empty)"}
                </text>
              </box>
            </Show>
            <For each={rows()}>{(row, position) => <RowView row={row} position={position()} />}</For>
          </scrollbox>
          <Show when={!simple()}>
            <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
              <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1}>
                {gitState().repo ? `±${gitState().changes.length} changes` : "no repository"}
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                ctrl+e
              </text>
            </box>
          </Show>
        </box>

        {/* Editor */}
        <Show when={showEditor()}>
          <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column" backgroundColor={surface()}>
            <Show when={!simple() && docs().length > 0}>
              <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
                <For each={docs()}>{(item, position) => <Tab item={item} position={position()} />}</For>
                <text fg={theme.text.muted} flexGrow={1} wrapMode="none">
                  {" "}
                </text>
              </box>
            </Show>
            <Show
              when={doc()?.path}
              keyed
              fallback={
                <box flexGrow={1} minHeight={0} flexDirection="column" alignItems="center" justifyContent="center" gap={1}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    {simple() ? "File browser" : "OpenCode files"}
                  </text>
                  <text fg={theme.text.muted}>
                    {simple() || docked() ? "Select a file on the left and press Enter." : "Browse, edit and review without leaving the TUI."}
                  </text>
                  <Show when={docked() && !simple()}>
                    <text fg={theme.text.muted} wrapMode="word">
                      tab pane · ctrl+f search · e edit · ctrl+s save
                    </text>
                  </Show>
                  <Show when={!simple() && !docked()}>
                    <box flexDirection="column" gap={1} paddingTop={1} border paddingLeft={2} paddingRight={2} borderColor={theme.border.base}>
                      <text fg={theme.text.action.primary.selected} attributes={TextAttributes.BOLD}>
                        Quick start
                      </text>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"↑ ↓ enter"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"move and open"}</text>
                      </box>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"ctrl+f / ctrl+e"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"search names or content"}</text>
                      </box>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"e / ctrl+s"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"edit and save"}</text>
                      </box>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"ctrl+g"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"git changes, stage and commit"}</text>
                      </box>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"F2"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"preferences, including simple mode"}</text>
                      </box>
                      <box flexDirection="row" gap={2}>
                        <text fg={theme.text.muted} wrapMode="none" width={18}>{"F1"}</text>
                        <text fg={theme.text.base} wrapMode="none">{"every shortcut"}</text>
                      </box>
                    </box>
                  </Show>
                </box>
              }
            >
              <ErrorBoundary
                fallback={(cause) => (
                  <box flexGrow={1} padding={1}>
                    <text fg={theme.text.feedback.error.base} wrapMode="word">
                      Could not render this file: {message(cause)}
                    </text>
                  </box>
                )}
              >
                <box flexGrow={1} minHeight={0} flexDirection="column">
                  <EditorView
                    doc={doc()!}
                    theme={theme}
                    syntax={syntax}
                    settings={options()}
                    editing={isEditing()}
                    markdownPreview={showMarkdown()}
                    focused={focus() === "editor"}
                    line={pendingLine()}
                    onText={(text) => updateDoc(doc()!, text)}
                    onSave={() => void save()}
                    onCursor={() => {}}
                    onLeave={() => setFocus("explorer")}
                    onKey={editorKey}
                    onToggleMode={toggleEdit}
                    onReady={(api) => (editorApi = api)}
                  />
                </box>
              </ErrorBoundary>
            </Show>
          </box>
        </Show>

        {/* Changes */}
        <Show when={showChanges()}>
          <box
            width={30}
            flexShrink={0}
            minHeight={0}
            flexDirection="column"
            border
            borderColor={focus() === "changes" ? theme.border.base : theme.background.raised.base}
            backgroundColor={surface()}
          >
            <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
                CHANGES
              </text>
              <text fg={theme.text.muted} wrapMode="none" flexGrow={1}>
                {gitState().changes.length}
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                {gitState().staged} staged
              </text>
            </box>
            <scrollbox flexGrow={1} minHeight={0} verticalScrollbarOptions={{ visible: true }}>
              <Show when={gitState().changes.length === 0}>
                <text fg={theme.text.muted} paddingLeft={1}>
                  No changes
                </text>
              </Show>
              <For each={gitState().changes}>
                {(change, position) => <ChangeRow change={change} position={position()} />}
              </For>
            </scrollbox>
            <Show when={composing()}>
              <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
                <input
                  ref={(element: InputRenderable) => {
                    commitInput = element
                    setTimeout(() => {
                      try {
                        element.focus()
                      } catch {}
                    }, 20)
                  }}
                  value={commitMessage()}
                  placeholder="Commit message…"
                  focused
                  backgroundColor={surface()}
                  textColor={theme.text.base}
                  focusedTextColor={theme.text.base}
                  onInput={(value: string) => setCommitMessage(value)}
                  onKeyDown={(event: any) => {
                    const key = String(event.name ?? event.key ?? "").toLowerCase()
                    if (key === "escape") {
                      setComposing(false)
                      return
                    }
                    if (key === "return" && (event.ctrl || event.meta)) {
                      setComposing(false)
                      void runGitAction("commit")
                    }
                  }}
                />
              </box>
            </Show>
            <box flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.muted} wrapMode="none">
                a stage · u unstage
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                d discard · c commit
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                l pull · p push
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                g history · b branch · R
              </text>
            </box>
          </box>
        </Show>

        {/* Splitter */}
        <Show when={!docked() && options().mouse}>
          <box
            width={1}
            flexShrink={0}
            backgroundColor={drag().active ? theme.border.base : surface()}
            onMouseDown={(event: any) => {
              if (event.button !== MouseButton.LEFT) return
              event.stopPropagation()
              setDrag({ active: true, width: explorerWidth() })
            }}
            onMouseDrag={(event: any) => {
              if (!drag().active) return
              event.stopPropagation()
              setSplitWidth(Math.max(18, Math.min(60, drag().width + event.deltaX)))
            }}
            onMouseUp={() => setDrag({ active: false, width: 0 })}
          />
        </Show>
      </box>

      {/* Footer */}
      <box height={1} flexShrink={0} paddingLeft={docked() ? 2 : 1} paddingRight={2} flexDirection="row" gap={1}>
        <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1}>
          {status() ??
            (typing()
              ? "typing · ctrl+s save · ctrl+←/→ tabs · esc leaves · F4 preview · F1 help"
              : focus() === "changes"
                ? "a stage · u unstage · d discard · c commit · l pull · p push · g history · b branches"
                : focus() === "editor"
                  ? "e edit · ctrl+s save · ctrl+w close · ctrl+←/→ tabs · m markdown · F1 help"
                  : "↑↓ move · enter open · → expand · ← collapse · tab pane · ctrl+f search · ctrl+e mode · F2 prefs · F1 help")}
        </text>
        <text fg={theme.text.muted} wrapMode="none">
          {simple() ? "simple" : `${docs().length} tabs`}
        </text>
        <Show when={props.panel}>
          <text fg={theme.text.muted} wrapMode="none">
            f fullscreen
          </text>
        </Show>
      </box>
    </box>
  )
}

// Built once per component instance; kept here so the theme rules stay in one
// place and nothing imports @opencode/theme at runtime.
function createSyntaxStyle(theme: Plugin.Context["theme"], owner: any) {
  const rule = (scope: string[], foreground: RGBA, extra: Record<string, any> = {}) => ({
    scope,
    style: { foreground, ...extra },
  })
  const syntax = theme.syntax
  const markdown = theme.markdown
  const feedback = theme.text.feedback
  const rules = [
    rule(["default"], theme.text.base),
    rule(["comment", "comment.documentation"], syntax.comment, { italic: true }),
    rule(["string", "symbol", "character", "character.special"], syntax.string),
    rule(["number", "boolean", "constant", "float"], syntax.number),
    rule(["keyword", "keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], syntax.keyword, {
      italic: true,
    }),
    rule(["keyword.type"], syntax.type, { bold: true, italic: true }),
    rule(["keyword.function", "function.method", "function", "constructor"], syntax.function),
    rule(["keyword.import", "string.escape", "string.regexp", "tag.attribute", "keyword.export"], syntax.keyword),
    rule(["operator", "keyword.operator", "punctuation.delimiter"], syntax.operator),
    rule(["variable", "variable.parameter", "property", "parameter", "field"], syntax.variable),
    rule(["variable.member", "function.method.call", "function.call"], syntax.function),
    rule(["type", "module", "class", "namespace"], syntax.type),
    rule(["punctuation", "punctuation.bracket"], syntax.punctuation),
    rule(
      ["variable.builtin", "type.builtin", "function.builtin", "constant.builtin", "variable.super", "tag"],
      feedback.error.base,
    ),
    rule(["attribute", "annotation"], feedback.warning.base),
    rule(["comment.error"], feedback.error.base, { bold: true, italic: true }),
    rule(["comment.warning"], feedback.warning.base, { bold: true, italic: true }),
    rule(["comment.todo", "comment.note"], feedback.info.base, { bold: true, italic: true }),
    rule(["error"], feedback.error.base, { bold: true }),
    rule(
      [
        "markup.heading",
        "markup.heading.1",
        "markup.heading.2",
        "markup.heading.3",
        "markup.heading.4",
        "markup.heading.5",
        "markup.heading.6",
      ],
      markdown.heading,
      { bold: true },
    ),
    rule(["markup.bold", "markup.strong"], markdown.strong, { bold: true }),
    rule(["markup.italic"], markdown.emphasis, { italic: true }),
    rule(["markup.quote"], markdown.blockQuote, { italic: true }),
    rule(["markup.raw", "markup.raw.block"], markdown.code),
    rule(["markup.link", "markup.link.url", "string.special.url"], markdown.link, { underline: true }),
    rule(["markup.list"], markdown.listItem),
    rule(["debug"], theme.text.muted),
  ]
  return SyntaxStyle.fromTheme(rules as any, owner)
}
