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
  readonly scroll?: number
}

export const isDirty = (doc: Doc) => doc.text !== doc.original

const gutterWidth = (lines: number) => Math.max(4, String(lines).length + 2)

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
}) {
  let contentScroll: ScrollBoxRenderable | undefined
  let textarea: TextareaRenderable | undefined
  const [cursor, setCursor] = createSignal({ line: 1, column: 1 })
  const [scrollLine, setScrollLine] = createSignal(0)
  const [viewport, setViewport] = createSignal(24)

  const lineCount = () => (props.doc.text.match(/\n/g)?.length ?? 0) + 1

  const syncViewport = () => {
    const scroll = contentScroll
    if (scroll && !scroll.isDestroyed) setViewport(scroll.viewport.height)
    if (textarea && !textarea.isDestroyed) {
      setScrollLine(textarea.scrollY)
      setViewport(textarea.height)
    }
  }

  // The editor scrolls inside the textarea; the gutter follows its scrollY.
  // Keyboard and mouse moves both end up here, and the timer catches drags.
  const timer = setInterval(syncViewport, 120)
  onCleanup(() => clearInterval(timer))

  createEffect(() => {
    props.doc.path
    setCursor({ line: 1, column: 1 })
    setScrollLine(0)
  })

  // The browser owns focus. When it moves to the explorer or the git panel the
  // textarea must release the keyboard, otherwise letters keep landing here.
  createEffect(() => {
    const element = textarea
    if (!element || element.isDestroyed) return
    if (props.focused && props.editing && !props.markdownPreview) element.focus()
    else element.blur()
  })

  createEffect(() => {
    const target = props.line
    if (!target) return
    const scroll = contentScroll
    if (!scroll || scroll.isDestroyed) return
    setTimeout(() => {
      if (scroll.isDestroyed) return
      scroll.scrollTo(Math.max(0, target - 3))
    }, 80)
  })

  const gutter = () => props.settings.lineNumbers && !(props.editing && props.settings.wrap)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={props.editing && !props.markdownPreview}>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <Show when={gutter()}>
            <Gutter theme={props.theme} lines={lineCount()} start={scrollLine()} height={viewport()} />
          </Show>
          <box flexGrow={1} minWidth={0} minHeight={0}>
            <textarea
              ref={(element: TextareaRenderable) => {
                textarea = element
                setTimeout(() => {
                  if (element && !element.isDestroyed && props.focused) element.focus()
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
                // The buffer can emit one empty change before initialValue lands;
                // never let that wipe the document we just loaded.
                if (next === "" && props.doc.text !== "") return
                props.onText(next)
              }}
              onCursorChange={(event: { line: number; visualColumn: number }) => {
                setCursor({ line: event.line + 1, column: event.visualColumn + 1 })
                props.onCursor(event.line + 1, event.visualColumn + 1)
                syncViewport()
              }}
              onKeyDown={(event: any) => {
                if (!props.onKey) return
                if (!props.onKey(event)) return
                event.preventDefault?.()
                event.stopPropagation?.()
                // Hand focus back to the keymap layer; otherwise the textarea
                // keeps consuming arrows and Enter after we leave the editor.
                if (event.name === "escape" || event.name === "tab") textarea?.blur()
              }}
              onMouseScroll={() => setTimeout(syncViewport, 0)}
            />
          </box>
        </box>
      </Show>

      <Show when={!props.editing || props.markdownPreview}>
        <Show
          when={props.doc.markdown && props.markdownPreview}
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
            <box paddingLeft={1} paddingRight={1} flexShrink={0}>
              <markdown
                content={props.doc.text}
                syntaxStyle={props.syntax}
                conceal
                fg={props.theme.markdown.text}
                bg={props.theme.background.base}
              />
            </box>
          </scrollbox>
        </Show>
      </Show>

      <Show when={props.doc.truncated}>
        <box height={1} flexShrink={0} paddingLeft={2}>
          <text fg={props.theme.text.feedback.warning.base} wrapMode="none">
            truncated for display · open with an external editor for the full file
          </text>
        </box>
      </Show>

      <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={2} paddingRight={2}>
        <text fg={props.theme.text.muted} wrapMode="none">
          {props.editing ? "edit" : props.markdownPreview && props.doc.markdown ? "preview" : "read"}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none">
          {props.doc.type}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none">
          Ln {cursor().line}, Col {cursor().column}
        </text>
        <text fg={isDirty(props.doc) ? props.theme.text.feedback.warning.base : props.theme.text.muted} wrapMode="none">
          {isDirty(props.doc) ? "unsaved" : "saved"}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none" flexGrow={1} truncate>
          {props.doc.external ? "external" : ""}
        </text>
        <text fg={props.theme.text.muted} wrapMode="none">
          {props.settings.wrap && props.editing ? "wrap on" : ""}
        </text>
      </box>
    </box>
  )
}
