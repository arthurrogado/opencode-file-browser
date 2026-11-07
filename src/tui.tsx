/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client"
import type { PanelInput, Route } from "@opencode/plugin/tui/context"
import { Plugin } from "@opencode/plugin/tui"
import { MouseButton, SyntaxStyle, TextAttributes, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { ErrorBoundary, For, Show, createEffect, createSignal, onMount } from "solid-js"

const ROUTE = "file-browser"
const MAX_LINES = 6000
const MAX_CHARS = 512 * 1024
const MAX_LINE_CHARS = 4000

type Entry = { readonly path: string; readonly type: "file" | "directory" }

type LoadedFile = {
  readonly path: string
  readonly text: string
  readonly type: string
  readonly markdown: boolean
  readonly truncated: boolean
}

const EXTENSIONS: Record<string, string> = {
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
  ".typc": "typst",
}

const basename = (path: string) => {
  const trimmed = path.replace(/\/+$/, "")
  const index = trimmed.lastIndexOf("/")
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

const extname = (path: string) => {
  const name = basename(path).toLowerCase()
  const index = name.lastIndexOf(".")
  return index <= 0 ? "" : name.slice(index)
}

const filetype = (path: string) => {
  const name = basename(path).toLowerCase()
  if (name === "makefile") return "makefile"
  if (name === "dockerfile") return "dockerfile"
  return EXTENSIONS[extname(path)] ?? "text"
}

const isMarkdown = (path: string) => {
  const ext = extname(path)
  return ext === ".md" || ext === ".markdown" || ext === ".mdx"
}

const parentOf = (path: string) => {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

// Some native text buffers cannot handle pathologically long lines; clip them
// instead of risking a renderer failure on minified bundles or data files.
const clampLongLines = (text: string) => {
  let clipped = false
  const lines = text.split("\n").map((line) => {
    if (line.length <= MAX_LINE_CHARS) return line
    clipped = true
    return line.slice(0, MAX_LINE_CHARS) + " …"
  })
  return { text: lines.join("\n"), clipped }
}

const message = (cause: unknown) => {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

const isBinary = (bytes: Uint8Array) => {
  const limit = Math.min(bytes.length, 8000)
  for (let index = 0; index < limit; index++) if (bytes[index] === 0) return true
  return false
}

// Mirrors the host theme's tree-sitter rules without importing @opencode/theme,
// which a local plugin cannot resolve at runtime.
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
    rule(["variable.builtin", "type.builtin", "function.builtin", "constant.builtin", "variable.super", "tag"], feedback.error.base),
    rule(["attribute", "annotation"], feedback.warning.base),
    rule(["comment.error"], feedback.error.base, { bold: true, italic: true }),
    rule(["comment.warning"], feedback.warning.base, { bold: true, italic: true }),
    rule(["comment.todo", "comment.note"], feedback.info.base, { bold: true, italic: true }),
    rule(["error"], feedback.error.base, { bold: true }),
    rule(["markup.heading", "markup.heading.2", "markup.heading.3"], markdown.heading, { bold: true }),
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

function FileBrowser(props: {
  context: Plugin.Context
  location: () => LocationRef
  panel?: PanelInput
  onClose: () => void
}) {
  const context = props.context
  const theme = context.theme
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [view, updateView] = context.storage.store<{ fullscreen: boolean }>("view", { initial: { fullscreen: false } })

  const syntax = createSyntaxStyle(theme, renderer.nativeScene)
  void renderer.idle?.()?.then(() => syntax.destroy())

  const surface = () => (props.panel && props.panel.presentation === "panel" ? theme.background.raised.base : theme.background.base)
  const docked = () => props.panel !== undefined && props.panel.presentation === "panel"

  const [dir, setDir] = createSignal("")
  const [entries, setEntries] = createSignal<readonly Entry[]>([])
  const [index, setIndex] = createSignal(0)
  const [focus, setFocus] = createSignal<"list" | "content">("list")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const [showHidden, setShowHidden] = createSignal(false)
  const [file, setFile] = createSignal<LoadedFile | undefined>()
  const [fileError, setFileError] = createSignal<string | undefined>()
  const [rendered, setRendered] = createSignal(true)

  // A key that opens this view keeps dispatching until the next frame, so the
  // first instant after mount ignores keys that would immediately act on it.
  const mountedAt = Date.now()
  const fresh = () => Date.now() - mountedAt < 150

  let listScroll: ScrollBoxRenderable | undefined
  let contentScroll: ScrollBoxRenderable | undefined
  // A hot reload or route change can dispose the renderables while a read is
  // still in flight; never touch a destroyed scrollbox.
  const content = () => (contentScroll && !contentScroll.isDestroyed ? contentScroll : undefined)
  const list = () => (listScroll && !listScroll.isDestroyed ? listScroll : undefined)
  const resetContentScroll = () => {
    if (renderer.isDestroyed) return
    try {
      renderer.requestAnimationFrame(() => content()?.scrollTo(0))
    } catch {}
  }
  let listToken = 0
  let readToken = 0

  const current = () => entries()[index()]

  async function load(path: string, resetSelection = true) {
    const token = ++listToken
    setLoading(true)
    setError(undefined)
    try {
      const result = await context.client.file.list({
        location: props.location(),
        path: path || undefined,
      })
      if (token !== listToken) return
      const items = result.data
        .filter((entry) => showHidden() || !basename(entry.path).startsWith("."))
        .map((entry) => ({ path: entry.path.replace(/\/+$/, ""), type: entry.type }))
        .sort((left, right) => {
          if (left.type !== right.type) return left.type === "directory" ? -1 : 1
          return basename(left.path).localeCompare(basename(right.path))
        })
      setEntries(items)
      setDir(path)
      const previous = index()
      setIndex(resetSelection ? 0 : Math.min(previous, Math.max(0, items.length - 1)))
    } catch (cause) {
      if (token !== listToken) return
      setEntries([])
      setError(message(cause))
    } finally {
      if (token === listToken) setLoading(false)
    }
  }

  async function read(entry: Entry) {
    const token = ++readToken
    setFileError(undefined)
    setRendered(true)
    setFocus("content")
    try {
      const bytes = await context.client.file.read({ location: props.location(), path: entry.path })
      if (token !== readToken) return
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBufferLike)
      if (isBinary(data)) {
        setFile(undefined)
        setFileError(`Binary file · ${formatBytes(data.length)}`)
        return
      }
      let text = new TextDecoder("utf-8").decode(data)
      let truncated = false
      const lines = text.split("\n")
      if (lines.length > MAX_LINES) {
        text = lines.slice(0, MAX_LINES).join("\n")
        truncated = true
      }
      if (text.length > MAX_CHARS) {
        text = text.slice(0, MAX_CHARS)
        truncated = true
      }
      const clamped = clampLongLines(text)
      text = clamped.text
      truncated = truncated || clamped.clipped
      setFile({ path: entry.path, text, type: filetype(entry.path), markdown: isMarkdown(entry.path), truncated })
      resetContentScroll()
    } catch (cause) {
      if (token === readToken) {
        setFile(undefined)
        setFileError(message(cause))
      }
    }
  }

  function open(entry: Entry) {
    if (entry.type === "directory") {
      setFile(undefined)
      setFileError(undefined)
      setFocus("list")
      void load(entry.path)
      return
    }
    void read(entry)
  }

  function move(delta: number) {
    if (focus() === "list") {
      const total = entries().length
      if (total === 0) return
      setIndex((value) => Math.max(0, Math.min(total - 1, value + delta)))
      return
    }
    content()?.scrollBy(delta)
  }

  function page(direction: -1 | 1) {
    if (focus() === "list") {
      move(direction * Math.max(1, Math.floor(dimensions().height / 2)))
      return
    }
    const scroll = content()
    if (!scroll) return
    scroll.scrollBy(direction * Math.max(1, Math.floor(scroll.viewport.height / 2)))
  }

  function goParent() {
    if (focus() === "content") {
      setFocus("list")
      return
    }
    if (!dir()) return
    void load(parentOf(dir()))
  }

  function reload() {
    const active = file()
    if (active) void read({ path: active.path, type: "file" })
    void load(dir(), false)
  }

  function toggleMarkdown() {
    if (!file()?.markdown) return
    setRendered((value) => !value)
    resetContentScroll()
  }

  function toggleFullscreen() {
    const panel = props.panel
    if (!panel) return
    const before = panel.presentation
    panel.toggleFullscreen()
    if (panel.presentation === before) return
    void updateView((draft) => {
      draft.fullscreen = panel.presentation === "fullscreen"
    })
  }

  function toggleHidden() {
    setShowHidden((value) => !value)
    void load(dir(), false)
  }

  const commands = [
    { id: "file-browser.close", title: "Close file browser", group: "Files", bind: "escape,q", run: () => props.onClose() },
    { id: "file-browser.down", title: "Next item", group: "Files", bind: "down,j", run: () => move(1) },
    { id: "file-browser.up", title: "Previous item", group: "Files", bind: "up,k", run: () => move(-1) },
    {
      id: "file-browser.select",
      title: "Open selected item",
      group: "Files",
      bind: "return,space",
      run: () => {
        if (fresh()) return
        const entry = current()
        if (entry) open(entry)
      },
    },
    { id: "file-browser.parent", title: "Go up one level", group: "Files", bind: "backspace,u", run: goParent },
    {
      id: "file-browser.focus",
      title: "Toggle list/file focus",
      group: "Files",
      bind: "tab",
      run: () => setFocus((value) => (value === "list" ? "content" : "list")),
    },
    { id: "file-browser.page_down", title: "Page down", group: "Files", bind: "pagedown,ctrl+f", run: () => page(1) },
    { id: "file-browser.page_up", title: "Page up", group: "Files", bind: "pageup,ctrl+b", run: () => page(-1) },
    {
      id: "file-browser.first",
      title: "Go to start",
      group: "Files",
      bind: "g,home",
      run: () => {
        if (focus() === "list") setIndex(0)
        else content()?.scrollTo(0)
      },
    },
    {
      id: "file-browser.last",
      title: "Go to end",
      group: "Files",
      bind: "shift+g,end",
      run: () => {
        if (focus() === "list") setIndex(Math.max(0, entries().length - 1))
        else {
          const scroll = content()
          if (scroll) scroll.scrollTo(scroll.scrollHeight)
        }
      },
    },
    { id: "file-browser.markdown", title: "Toggle Markdown/source", group: "Files", bind: "m", run: toggleMarkdown },
    { id: "file-browser.reload", title: "Reload", group: "Files", bind: "r", run: reload },
    { id: "file-browser.hidden", title: "Toggle hidden files", group: "Files", bind: "h", run: toggleHidden },
    {
      id: "file-browser.fullscreen",
      title: "Toggle fullscreen",
      group: "Files",
      bind: "f",
      run: () => {
        if (fresh()) return
        toggleFullscreen()
      },
    },
  ]

  context.keymap.layer(() => ({
    priority: 100,
    enabled: () => (props.panel ? props.panel.focused : true),
    commands,
  }))

  // The panel is mounted once per open; load the root of the session location.
  onMount(() => void load(""))

  let lastRoot: string | undefined
  createEffect(() => {
    const root = props.location().directory
    if (root === lastRoot) return
    lastRoot = root
    setFile(undefined)
    setFileError(undefined)
    setFocus("list")
    void load("")
  })

  // Keep the selected row visible while navigating with the keyboard.
  createEffect(() => {
    const selected = index()
    const total = entries().length
    if (total === 0) return
    const scroll = list()
    if (!scroll || scroll.isDestroyed) return
    if (selected < scroll.scrollTop) scroll.scrollTo(selected)
    else if (selected + 1 > scroll.scrollTop + scroll.viewport.height)
      scroll.scrollTo(selected + 1 - scroll.viewport.height)
  })

  const availableWidth = () => (props.panel ? props.panel.width : dimensions().width)
  const listWidth = () => Math.max(20, Math.min(42, Math.floor(availableWidth() * 0.3)))
  const breadcrumb = () => {
    const root = context.ui.format.path(props.location().directory)
    const rest = dir()
    return rest ? `${root}/${rest}` : root
  }

  const Row = (props2: { entry: Entry; active: boolean }) => {
    const [hovered, setHovered] = createSignal(false)
    const directory = () => props2.entry.type === "directory"
    return (
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props2.active ? theme.background.raised.max : hovered() ? theme.background.raised.high : surface()}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => {
          if (event.button !== MouseButton.LEFT) return
          event.stopPropagation()
          setFocus("list")
          setIndex(entries().indexOf(props2.entry))
          open(props2.entry)
        }}
      >
        <text
          fg={
            props2.active
              ? theme.text.action.primary.selected
              : directory()
                ? theme.text.action.secondary.base
                : theme.text.base
          }
          attributes={props2.active ? TextAttributes.BOLD : 0}
          wrapMode="none"
          truncate
          selectable={false}
        >
          {directory() ? "▸ " : "  "}
          {basename(props2.entry.path)}
          {directory() ? "/" : ""}
        </text>
      </box>
    )
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={surface()}>
      <box
        height={docked() ? 2 : 1}
        paddingTop={docked() ? 1 : 0}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
        flexDirection="row"
        gap={1}
      >
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
          files
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          {breadcrumb()}
        </text>
        <text fg={error() ? theme.text.feedback.error.base : theme.text.muted} wrapMode="none" flexShrink={0}>
          {loading() ? "loading…" : error() ? "error" : `${entries().length} ${entries().length === 1 ? "item" : "items"}`}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} paddingLeft={docked() ? 2 : 0} paddingRight={docked() ? 2 : 0}>
        <box
          width={listWidth()}
          flexShrink={0}
          flexDirection="column"
          minHeight={0}
          border
          borderColor={focus() === "list" ? theme.border.base : theme.background.raised.base}
          backgroundColor={surface()}
        >
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (listScroll = element)}
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: true }}
            scrollAcceleration={undefined}
          >
            <Show when={error()}>
              <text fg={theme.text.feedback.error.base} paddingLeft={1} paddingRight={1} wrapMode="word">
                {error()}
              </text>
            </Show>
            <Show when={!error() && !loading() && entries().length === 0}>
              <text fg={theme.text.muted} paddingLeft={1}>
                (empty)
              </text>
            </Show>
            <For each={entries()}>
              {(entry, position) => <Row entry={entry} active={position() === index()} />}
            </For>
          </scrollbox>
          <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row">
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {dir() ? "../" : context.ui.format.path(props.location().directory)}
            </text>
          </box>
        </box>

        <box
          flexGrow={1}
          minWidth={0}
          minHeight={0}
          flexDirection="column"
          border
          borderColor={focus() === "content" ? theme.border.base : theme.background.raised.base}
          backgroundColor={surface()}
        >
          <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexGrow={1} minWidth={0}>
              {file() ? basename(file()!.path) : ""}
            </text>
            <Show when={file()}>
              {(active) => (
                <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
                  {active().type}
                  {active().truncated ? " · truncated" : ""}
                  {active().markdown ? (rendered() ? " · md" : " · source") : ""}
                </text>
              )}
            </Show>
          </box>

          <Show when={fileError()}>
            <box flexGrow={1} padding={1}>
              <text fg={theme.text.feedback.error.base} wrapMode="word">
                {fileError()}
              </text>
            </box>
          </Show>

          <Show when={!fileError() && !file()}>
            <box flexGrow={1} padding={1}>
              <text fg={theme.text.muted} wrapMode="word">
                Select a file on the left and press Enter.
              </text>
            </box>
          </Show>

          <ErrorBoundary
            fallback={(error) => (
              <box flexGrow={1} padding={1}>
                <text fg={theme.text.feedback.error.base} wrapMode="word">
                  Could not render this file: {message(error)}
                </text>
              </box>
            )}
          >
          <Show when={!fileError() && file()}>
            {(active) => (
              <Show
                when={active().markdown && rendered()}
                fallback={
                  <scrollbox
                    ref={(element: ScrollBoxRenderable) => (contentScroll = element)}
                    flexGrow={1}
                    minHeight={0}
                    verticalScrollbarOptions={{ visible: true }}
                  >
                    <box paddingLeft={1} paddingRight={1} flexShrink={0}>
                      <code content={active().text} filetype={active().type} syntaxStyle={syntax} wrapMode="word" />
                    </box>
                    <Show when={active().truncated}>
                      <text fg={theme.text.muted} paddingLeft={1} paddingTop={1}>
                        … content truncated for display
                      </text>
                    </Show>
                  </scrollbox>
                }
              >
                <scrollbox
                  ref={(element: ScrollBoxRenderable) => (contentScroll = element)}
                  flexGrow={1}
                  minHeight={0}
                  verticalScrollbarOptions={{ visible: true }}
                >
                  <box paddingLeft={1} paddingRight={1} flexShrink={0}>
                    <markdown
                      content={active().text}
                      syntaxStyle={syntax}
                      conceal
                      fg={theme.markdown.text}
                      bg={surface()}
                    />
                  </box>
                  <Show when={active().truncated}>
                    <text fg={theme.text.muted} paddingLeft={1} paddingTop={1}>
                      … content truncated for display
                    </text>
                  </Show>
                </scrollbox>
              </Show>
            )}
          </Show>
          </ErrorBoundary>
        </box>
      </box>

      <box height={1} flexShrink={0} paddingLeft={docked() ? 2 : 1} paddingRight={2} flexDirection="row" gap={1}>
        <text fg={focus() === "list" ? theme.text.base : theme.text.muted} wrapMode="none" flexShrink={0}>
          list
        </text>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
          /
        </text>
        <text fg={focus() === "content" ? theme.text.base : theme.text.muted} wrapMode="none" flexShrink={0}>
          file
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          ↑↓ enter ⌫ tab m r h {props.panel ? "f " : ""}esc
        </text>
      </box>
    </box>
  )
}

function BrowserRoute(props: {
  context: Plugin.Context
  data?: { directory?: string; returnRoute?: Route }
}) {
  const dimensions = useTerminalDimensions()
  const location = () =>
    props.data?.directory
      ? { directory: props.data.directory }
      : (props.context.location ?? props.context.data.location.default())
  return (
    <box
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
    >
      <FileBrowser
        context={props.context}
        location={location}
        onClose={() => props.context.ui.router.navigate(props.data?.returnRoute ?? { type: "home" })}
      />
    </box>
  )
}

function Commands(props: { context: Plugin.Context }) {
  const [view] = props.context.storage.store<{ fullscreen: boolean }>("view", { initial: { fullscreen: false } })
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "file-browser.open",
        title: "Open file browser",
        description: "Browse folders and preview Markdown and code",
        group: "Files",
        palette: true,
        suggested: true,
        slash: { name: "files", aliases: ["browse", "arquivos"] },
        bind: "<leader>f",
        run() {
          const route = props.context.ui.router.current()
          props.context.ui.dialog.clear()
          if (route.type === "plugin" && route.name === ROUTE) {
            const back = (route.data?.returnRoute ?? { type: "home" }) as Route
            props.context.ui.router.navigate(back.type === "plugin" && back.name === ROUTE ? { type: "home" } : back)
            return
          }
          const panel = props.context.ui.panel.current()
          if (route.type === "session" && panel?.sessionID === route.sessionID && panel.name === ROUTE) {
            props.context.ui.panel.close()
            return
          }
          if (props.context.ui.panel.open(ROUTE, { presentation: view.fullscreen ? "fullscreen" : "panel" })) return
          const returnRoute: Route =
            route.type === "home"
              ? { type: "home" }
              : route.type === "session"
                ? { type: "session", sessionID: route.sessionID }
                : {
                    type: "plugin",
                    id: route.id,
                    name: route.name,
                    ...(route.data ? { data: { ...route.data } } : {}),
                  }
          // Defer so the key that opened us finishes dispatching before the
          // route mounts its own keymap layer.
          setTimeout(
            () =>
              props.context.ui.router.navigate({
                type: "plugin",
                name: ROUTE,
                data: {
                  sessionID: route.type === "session" ? route.sessionID : undefined,
                  directory:
                    route.type === "session"
                      ? (props.context.data.session.get(route.sessionID)?.location?.directory ??
                        props.context.data.location.default().directory)
                      : props.context.data.location.default().directory,
                  returnRoute,
                },
              }),
            0,
          )
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "file-browser",
  setup(context) {
    const offPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === ROUTE}>
          <FileBrowser
            context={context}
            location={() => context.data.session.get(panel.sessionID)?.location ?? context.data.location.default()}
            panel={panel}
            onClose={panel.close}
          />
        </Show>
      ),
    })
    const offRoute = context.ui.router.register({
      name: ROUTE,
      render: ({ data }) => <BrowserRoute context={context} data={data} />,
    })
    const offCommands = context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    return () => {
      offRoute()
      offPanel()
      offCommands()
    }
  },
})
