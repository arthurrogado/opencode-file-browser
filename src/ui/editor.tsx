import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { Settings } from "../lib/settings.js"

export type Doc = {
  readonly path: string
  readonly external: boolean
  readonly text: string
  readonly original: string
  readonly type: string
  readonly markdown: boolean
  readonly truncated: boolean
  readonly readOnly: boolean
  /** A unified diff (git output) instead of a file buffer. */
  readonly diff?: boolean
  /** File behind a diff tab, for the "open the real file" toggle. */
  readonly rawPath?: string
  /** Too large to render; only metadata is shown. */
  readonly oversize?: boolean
  readonly lines?: number
  /** Bumped when the buffer is replaced from disk, to refresh the textarea. */
  readonly rev?: number
}

export const isDirty = (doc: Doc) => (doc.diff ? false : doc.text !== doc.original)

const gutterWidth = (lines: number) => Math.max(4, String(lines).length + 2)

const KEYWORDS = new Set(
  "abstract as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield".split(
    " ",
  ),
)

type Token = readonly [number, number, string]

/**
 * Cheap per-line tokenizer. The host textarea has no tree-sitter integration,
 * so edit mode keeps colours through extmarks instead of the renderer's
 * highlighter. Only the common languages get real rules; everything else gets
 * comments/strings/numbers.
 */
function tokenize(line: string, type: string): Token[] {
  const tokens: Token[] = []
  const push = (start: number, end: number, kind: string) => {
    if (end > start) tokens.push([start, end, kind])
  }
  const markdown = type === "markdown"
  const python = type === "python" || type === "bash"
  const hashComments = python || type === "yaml" || type === "toml" || type === "ruby"

  if (markdown) {
    const heading = /^(#{1,6})\s+.*$/.exec(line)
    if (heading) {
      push(0, line.length, "keyword")
      return tokens
    }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      push(fence.index, fence.index + fence[0].trim().length, "type")
      return tokens
    }
    for (const match of line.matchAll(/(`[^`]+`)|(\[[^\]]*\]\([^)]*\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g)) {
      const kind = match[1] ? "string" : match[2] ? "function" : "keyword"
      push(match.index!, match.index! + match[0].length, kind)
    }
    return tokens
  }

  const pattern =
    /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=+\-*/<>!&|?]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line))) {
    const [text, , stringValue, number, word, punct] = match
    const start = match.index
    if (match[1] && (match[1].startsWith("//") || match[1].startsWith("#") || match[1].startsWith("/*"))) {
      // `#` is only a comment when the language says so; otherwise it is a
      // private field or a CSS colour and must be left alone.
      if (hashComments || match[1].startsWith("//") || match[1].startsWith("/*")) {
        push(start, start + text.length, "comment")
        break
      }
    }
    if (stringValue) push(start, start + text.length, "string")
    else if (number) push(start, start + text.length, "number")
    else if (word) {
      if (KEYWORDS.has(word)) push(start, start + text.length, "keyword")
      else if (/^[A-Z]/.test(word)) push(start, start + text.length, "type")
      else if (line[pattern.lastIndex] === "(") push(start, start + text.length, "function")
    } else if (punct) push(start, start + text.length, "punctuation")
  }
  return tokens
}

function Gutter(props: { theme: ResolvedTheme; lines: number; start: number; height: number }) {
  const text = () => {
    const first = Math.max(0, props.start)
    const total = Math.max(1, props.height)
    const last = Math.min(props.lines, first + total)
    const values: string[] = []
    for (let line = first + 1; line <= last; line++) values.push(String(line).padStart(gutterWidth(props.lines) - 1, " ") + " ")
    return values.join("\n") || " "
  }
  return (
    <box width={gutterWidth(props.lines)} flexShrink={0} flexDirection="column">
      <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
        {text()}
      </text>
    </box>
  )
}

/** One-column scroll indicator drawn from the absolute scroll position. */
function ScrollBar(props: { theme: ResolvedTheme; start: number; total: number; viewport: number; height: number }) {
  const S = "\u2588"
  const text = () => {
    const height = Math.max(1, props.height)
    if (props.total <= props.viewport || props.viewport <= 0) return "░".repeat(height)
    const thumb = Math.max(1, Math.round((props.viewport / props.total) * height))
    const max = props.total - props.viewport
    const at = Math.round((Math.max(0, Math.min(max, props.start)) / max) * (height - thumb))
    return "░".repeat(at) + S.repeat(thumb) + "░".repeat(Math.max(0, height - at - thumb))
  }
  return (
    <box width={1} flexShrink={0} flexDirection="column">
      <text fg={props.theme.text.feedback.info.base} wrapMode="none" selectable={false}>
        {text()}
      </text>
    </box>
  )
}

export function EditorView(props: {
  doc: Doc
  theme: ResolvedTheme
  syntax: any
  settings: Settings
  editing: boolean
  markdownPreview: boolean
  focused: boolean
  line?: number
  onText: (text: string) => void
  onSave: () => void
  onCursor: (line: number, column: number) => void
  onLeave: () => void
  onKey?: (event: any) => boolean
  onToggleMode?: () => void
  onReady?: (api: { newline: () => void }) => void
}) {
  let contentScroll: ScrollBoxRenderable | undefined
  let textarea: TextareaRenderable | undefined
  let findInput: any
  let highlightTypeId: number | undefined
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = true

  const [cursor, setCursor] = createSignal({ line: 1, column: 1 })
  const [scrollLine, setScrollLine] = createSignal(0)
  const [viewport, setViewport] = createSignal(24)
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal("")
  const [findStatus, setFindStatus] = createSignal("")

  onCleanup(() => {
    mounted = false
    clearInterval(timer)
    clearTimeout(highlightTimer)
  })

  const lineCount = () => (props.doc.text.match(/\n/g)?.length ?? 0) + 1

  const syncViewport = () => {
    const scroll = contentScroll
    if (scroll && !scroll.isDestroyed) setViewport(scroll.viewport.height)
    if (textarea && !textarea.isDestroyed) {
      setScrollLine(textarea.scrollY)
      setViewport(textarea.height)
    }
  }
  const timer = setInterval(syncViewport, 100)


  const focusNow = () => {
    const element = textarea
    if (!element || element.isDestroyed || !mounted) return
    try {
      element.focus()
    } catch {}
  }

  // The host reconciles focus one frame after a pane switch, so a single
  // focus() call can be undone. Retry briefly until the textarea really owns
  // the keyboard; this is what made editing "lock up" after tab navigation.
  const focusEditor = () => {
    for (const delay of [0, 24, 60, 120, 220]) setTimeout(() => {
      if (!mounted) return
      if (!props.focused || !props.editing || props.markdownPreview) return
      if (textarea && !textarea.isDestroyed && !textarea.focused) focusNow()
    }, delay)
  }

  createEffect(() => {
    // Read the reactive props *before* the ref check: reading only the plain
    // `textarea` variable would leave the effect with no dependencies and it
    // would never run again after the first (ref-less) run.
    const want = props.focused && props.editing && !props.markdownPreview
    const element = textarea
    if (want) focusEditor()
    else if (element && !element.isDestroyed) {
      try {
        element.blur()
      } catch {}
    }
  })

  createEffect(() => {
    const revision = props.doc.rev ?? 0
    if (!revision) return
    const element = textarea
    if (!element || element.isDestroyed) return
    try {
      element.editBuffer.setText(props.doc.text)
      setCursor({ line: 1, column: 1 })
      scheduleHighlight()
    } catch {}
  })

  createEffect(() => {
    props.doc.path
    setCursor({ line: 1, column: 1 })
    setScrollLine(0)
    setFindOpen(false)
    setFindQuery("")
    setTimeout(() => {
      syncViewport()
      scheduleHighlight()
    }, 40)
  })

  // ---------------------------------------------------------------- highlight
  function ensureType() {
    if (highlightTypeId !== undefined) return highlightTypeId
    const element = textarea
    if (!element || element.isDestroyed) return undefined
    highlightTypeId = element.extmarks.registerType("ofb-highlight")
    return highlightTypeId
  }

  function applyHighlights() {
    const element = textarea
    if (!element || element.isDestroyed) return
    if (props.settings.simple || props.markdownPreview || props.doc.diff) return
    const text = props.doc.text
    if (text.length > 200_000 || lineCount() > 3_000) return
    const typeId = ensureType()
    if (typeId === undefined) return
    try {
      for (const mark of element.extmarks.getAllForTypeId(typeId)) element.extmarks.delete(mark.id)
    } catch {}
    const style = (name: string) => {
      const id = props.syntax.getStyleId(name)
      return id === undefined ? null : id
    }
    const ids: Record<string, number | null> = {
      comment: style("comment"),
      string: style("string"),
      number: style("number"),
      keyword: style("keyword"),
      function: style("function"),
      type: style("type"),
      punctuation: style("punctuation"),
    }
    let lineStart = 0
    const lines = text.split("\n")
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!
      if (line.length <= 400) {
        for (const [start, end, kind] of tokenize(line, props.doc.type)) {
          const styleId = ids[kind]
          if (!styleId) continue
          try {
            element.extmarks.create({ start: lineStart + start, end: lineStart + end, styleId, priority: 10, typeId })
          } catch {}
        }
      }
      lineStart += line.length + 1
    }
  }

  function scheduleHighlight() {
    clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      try {
        applyHighlights()
      } catch {}
    }, 180)
  }

  // -------------------------------------------------------------- find in file
  function runFind(from = textarea?.cursorOffset ?? 0) {
    const query = findQuery()
    if (!query || !textarea) return
    const text = props.doc.text.toLowerCase()
    const needle = query.toLowerCase()
    const at = text.indexOf(needle, from)
    const found = at >= 0 ? at : text.indexOf(needle, 0)
    if (found < 0) {
      setFindStatus("not found")
      return
    }
    try {
      textarea.editBuffer.setCursorByOffset(found)
      setFindStatus(`match at ${found + 1}`)
    } catch {}
  }

  function leaveFind() {
    setFindOpen(false)
    setFindQuery("")
    setFindStatus("")
    focusEditor()
  }

  const gutter = () => props.settings.lineNumbers && !(props.editing && props.settings.wrap)

  if (props.doc.oversize) {
    return (
      <box flexDirection="column" flexGrow={1} minHeight={0} alignItems="center" justifyContent="center" gap={1}>
        <text fg={props.theme.text.feedback.warning.base} attributes={TextAttributes.BOLD}>
          file too large to render
        </text>
        <text fg={props.theme.text.base} wrapMode="none">
          {props.doc.lines ?? "many"} lines · {props.doc.type}
        </text>
        <text fg={props.theme.text.muted} wrapMode="word">
          The TUI stays responsive by not loading it. Open it in an external editor,
          or raise the limits in src/lib/util.ts if you really need it here.
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={findOpen()}>
        <box height={1} flexShrink={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
          <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
            find
          </text>
          <box flexGrow={1} minWidth={0}>
            <input
              ref={(element: any) => {
                findInput = element
                setTimeout(() => {
                  try {
                    element.focus()
                  } catch {}
                }, 20)
              }}
              value={findQuery()}
              placeholder="text in this file"
              backgroundColor={props.theme.background.raised.base}
              textColor={props.theme.text.base}
              onInput={(value: string) => {
                setFindQuery(value)
                setFindStatus("")
              }}
              onKeyDown={(event: any) => {
                const key = String(event.name ?? event.key ?? "").toLowerCase()
                if (key === "escape") {
                  event.preventDefault?.()
                  leaveFind()
                  return
                }
                if (key === "return") {
                  event.preventDefault?.()
                  runFind((textarea?.cursorOffset ?? 0) + 1)
                }
              }}
            />
          </box>
          <text fg={props.theme.text.muted} wrapMode="none">
            {findStatus() || "enter next · esc close"}
          </text>
        </box>
      </Show>

      <Show when={props.editing && !props.markdownPreview}>
        <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={2} paddingRight={2}>
          <text fg={props.theme.text.feedback.warning.base} wrapMode="none" flexShrink={0}>
            editing
          </text>
          <text fg={props.theme.text.muted} wrapMode="none" truncate flexGrow={1}>
            ctrl+s save · ctrl+f find · esc leaves · F4 preview
          </text>
        </box>
      </Show>

      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={props.editing && !props.markdownPreview}>
          <Show when={gutter()}>
            <Gutter theme={props.theme} lines={lineCount()} start={scrollLine()} height={viewport()} />
          </Show>
          <box flexGrow={1} minWidth={0} minHeight={0}>
            <textarea
              ref={(element: TextareaRenderable) => {
                textarea = element
                props.onReady?.({
                  newline: () => {
                    if (!element || element.isDestroyed) return
                    try {
                      element.editBuffer.newLine()
                      props.onText(element.plainText)
                      scheduleHighlight()
                      syncViewport()
                    } catch {}
                  },
                })
                setTimeout(() => {
                  if (element && !element.isDestroyed && props.focused) focusEditor()
                  scheduleHighlight()
                  syncViewport()
                }, 30)
              }}
              initialValue={props.doc.text}
              syntaxStyle={props.syntax}
              wrapMode={props.settings.wrap ? "word" : "none"}
              backgroundColor={props.theme.background.base}
              textColor={props.theme.text.base}
              focusedTextColor={props.theme.text.base}
              focusedBackgroundColor={props.theme.background.base}
              onContentChange={() => {
                if (!textarea || textarea.isDestroyed) return
                const next = textarea.plainText
                if (next === "" && props.doc.text !== "") return
                props.onText(next)
                scheduleHighlight()
                syncViewport()
              }}
              onCursorChange={(event: { line: number; visualColumn: number }) => {
                setCursor({ line: event.line + 1, column: event.visualColumn + 1 })
                props.onCursor(event.line + 1, event.visualColumn + 1)
                syncViewport()
              }}
              onKeyDown={(event: any) => {
                const key = String(event.name ?? event.key ?? "").toLowerCase()
                const ctrl = !!(event.ctrl || event.meta)
                if (key === "return") {
                  event.preventDefault?.()
                  event.stopPropagation?.()
                  try {
                    textarea?.editBuffer.newLine()
                    props.onText(textarea?.plainText ?? props.doc.text)
                    scheduleHighlight()
                  } catch {}
                  return
                }
                if (ctrl && key === "f") {
                  event.preventDefault?.()
                  event.stopPropagation?.()
                  setFindOpen(true)
                  return
                }
                if (!props.onKey) return
                if (!props.onKey(event)) return
                event.preventDefault?.()
                event.stopPropagation?.()
                if (key === "escape" || key === "tab") textarea?.blur()
              }}
              onMouseDown={(event: any) => {
                if (event.button !== 0) return
                event.stopPropagation?.()
                const element = textarea
                if (!element || element.isDestroyed) return
                focusNow()
                try {
                  const row = Math.floor(event.y - element.screenY) + element.scrollY
                  const col = Math.max(0, Math.floor(event.x - element.screenX))
                  element.editBuffer.setCursor(Math.max(0, row), col)
                  syncViewport()
                } catch {}
              }}
              onMouseScroll={() => setTimeout(syncViewport, 0)}
            />
          </box>
          <ScrollBar theme={props.theme} start={scrollLine()} total={lineCount()} viewport={viewport()} height={viewport()} />
        </Show>

        <Show when={!props.editing || props.markdownPreview}>
          <Show
            when={props.doc.markdown && props.markdownPreview}
            fallback={
              <Show
                when={props.doc.diff}
                fallback={
                  <scrollbox
                    ref={(element: ScrollBoxRenderable) => {
                      contentScroll = element
                      setTimeout(syncViewport, 30)
                    }}
                    flexGrow={1}
                    minHeight={0}
                    verticalScrollbarOptions={{ visible: true }}
                    onMouseScroll={() => setTimeout(syncViewport, 0)}
                  >
                    <box flexDirection="row" flexShrink={0}>
                      <Show when={gutter()}>
                        <box width={gutterWidth(lineCount())} flexShrink={0} flexDirection="column">
                          <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
                            {Array.from({ length: lineCount() }, (_, index) => String(index + 1).padStart(gutterWidth(lineCount()) - 1, " ") + " ").join("\n")}
                          </text>
                        </box>
                      </Show>
                      <box flexGrow={1} minWidth={0}>
                        <code content={props.doc.text} filetype={props.doc.type} syntaxStyle={props.syntax} wrapMode="none" />
                      </box>
                    </box>
                  </scrollbox>
                }
              >
                <scrollbox flexGrow={1} minHeight={0} verticalScrollbarOptions={{ visible: true }}>
                  <diff diff={props.doc.text} view="unified" filetype={props.doc.type} syntaxStyle={props.syntax} wrapMode="none" />
                </scrollbox>
              </Show>
            }
          >
            <scrollbox flexGrow={1} minHeight={0} verticalScrollbarOptions={{ visible: true }}>
              <box paddingLeft={1} paddingRight={1} flexShrink={0}>
                <markdown content={props.doc.text} syntaxStyle={props.syntax} conceal fg={props.theme.markdown.text} bg={props.theme.background.base} />
              </box>
            </scrollbox>
          </Show>
        </Show>
      </box>

      <Show when={props.doc.truncated}>
        <box height={1} flexShrink={0} paddingLeft={2}>
          <text fg={props.theme.text.feedback.warning.base} wrapMode="none">
            truncated for display · open with an external editor for the full file
          </text>
        </box>
      </Show>

      <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={2} paddingRight={2}>
        <text
          fg={props.theme.text.action.primary.selected}
          wrapMode="none"
          flexShrink={0}
          onMouseUp={(event: any) => {
            if (event.button !== 0) return
            event.stopPropagation?.()
            props.onToggleMode?.()
          }}
        >
          {props.editing ? "edit" : props.doc.diff ? "diff" : props.markdownPreview && props.doc.markdown ? "preview" : "read"}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none" flexShrink={0}>
          {props.doc.type}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none" flexShrink={0}>
          Ln {cursor().line}, Col {cursor().column}
        </text>
        <text fg={isDirty(props.doc) ? props.theme.text.feedback.warning.base : props.theme.text.muted} wrapMode="none" flexShrink={0}>
          {isDirty(props.doc) ? "unsaved" : "saved"}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          {props.doc.external ? "external" : ""}
        </text>
        <Show when={props.settings.wrap && props.editing}>
          <text fg={props.theme.text.muted} wrapMode="none" flexShrink={0}>
            wrap
          </text>
        </Show>
      </box>
    </box>
  )
}
