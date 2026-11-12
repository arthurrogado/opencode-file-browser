import { For, createSignal } from "solid-js"
import { MouseButton, TextAttributes } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { DEFAULTS, type Settings } from "../lib/settings.js"

type Row = {
  readonly key: keyof Settings
  readonly label: string
  readonly hint: string
  readonly kind: "toggle" | "choice"
  readonly values?: readonly string[]
}

const ROWS: readonly Row[] = [
  { key: "simple", label: "Simple mode", hint: "classic list + preview only", kind: "toggle" },
  { key: "lineNumbers", label: "Line numbers", hint: "gutter in viewer and editor", kind: "toggle" },
  { key: "wrap", label: "Wrap lines", hint: "wrap while editing", kind: "toggle" },
  { key: "tree", label: "Folders", hint: "expand in place or navigate into", kind: "choice", values: ["expand", "navigate"] },
  { key: "panelPreview", label: "Panel preview", hint: "preview in session panel", kind: "toggle" },
  { key: "changes", label: "Changes panel", hint: "git stage, commit, push", kind: "toggle" },
  { key: "hidden", label: "Hidden files", hint: "list dotfiles", kind: "toggle" },
  { key: "mouse", label: "Mouse", hint: "click, scroll and drag", kind: "toggle" },
  { key: "search", label: "Search", hint: "default search target", kind: "choice", values: ["name", "content"] },
  { key: "caseSensitive", label: "Case sensitive", hint: "match case in searches", kind: "toggle" },
  { key: "confirmDiscard", label: "Confirm discard", hint: "ask before discarding", kind: "toggle" },
]

export function SettingsDialog(props: {
  context: Plugin.Context
  value: Settings
  onChange: (mutation: (draft: Settings) => void) => void
  onClose: () => void
}) {
  const theme = props.context.theme
  const [index, setIndex] = createSignal(0)
  const [draft, setDraft] = createSignal<Settings>({ ...props.value })

  const set = (mutation: (draft: Settings) => void) => {
    const next = { ...draft() }
    mutation(next)
    setDraft(next)
    props.onChange(mutation)
  }

  const cycle = (row: Row, direction = 1) => {
    const current = draft()[row.key]
    if (row.kind === "toggle") {
      set((next) => {
        ;(next as any)[row.key] = !current
      })
      return
    }
    const values = row.values ?? []
    const at = values.indexOf(String(current))
    const target = values[(at + direction + values.length) % values.length]
    set((next) => {
      ;(next as any)[row.key] = target
    })
  }

  const label = (row: Row) => {
    const value = draft()[row.key]
    if (row.kind === "toggle") return value ? "on" : "off"
    return String(value)
  }

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 200,
    commands: [
      {
        id: "file-browser.settings.down",
        title: "Next preference",
        bind: "down,j",
        run: () => setIndex((value) => Math.min(ROWS.length - 1, value + 1)),
      },
      {
        id: "file-browser.settings.up",
        title: "Previous preference",
        bind: "up,k",
        run: () => setIndex((value) => Math.max(0, value - 1)),
      },
      {
        id: "file-browser.settings.toggle",
        title: "Toggle preference",
        bind: "space,return",
        run: () => cycle(ROWS[index()]!),
      },
      {
        id: "file-browser.settings.prev",
        title: "Previous value",
        bind: "left",
        run: () => cycle(ROWS[index()]!, -1),
      },
      {
        id: "file-browser.settings.next",
        title: "Next value",
        bind: "right",
        run: () => cycle(ROWS[index()]!),
      },
      {
        id: "file-browser.settings.reset",
        title: "Restore defaults",
        bind: "r",
        run: () => set((next) => Object.assign(next, DEFAULTS)),
      },
      {
        id: "file-browser.settings.close",
        title: "Close preferences",
        bind: "escape,q",
        run: () => props.onClose(),
      },
    ],
  }))

  return (
    <box flexDirection="column" padding={1} gap={0} backgroundColor={theme.background.base}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Preferences
        </text>
        <text fg={theme.text.muted} flexGrow={1} truncate>
          saved automatically
        </text>
      </box>
      <For each={ROWS}>
        {(row, position) => (
          <box
            flexDirection="row"
            height={1}
            paddingLeft={1}
            paddingRight={1}
            gap={1}
            backgroundColor={position() === index() ? theme.background.raised.max : theme.background.base}
            onMouseUp={(event: any) => {
              if (event.button !== MouseButton.LEFT || !draft().mouse) return
              event.stopPropagation()
              setIndex(position())
              cycle(row)
            }}
          >
            <text
              fg={position() === index() ? theme.text.action.primary.selected : theme.text.base}
              wrapMode="none"
              width={18}
              flexShrink={0}
            >
              {(position() === index() ? "› " : "  ") + row.label}
            </text>
            <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
              {row.hint}
            </text>
            <text
              fg={draft()[row.key] === DEFAULTS[row.key] ? theme.text.muted : theme.text.feedback.success.base}
              wrapMode="none"
              width={13}
              flexShrink={0}
            >
              {row.kind === "choice" ? `‹ ${label(row)} ›` : label(row)}
            </text>
          </box>
        )}
      </For>
      <box height={1} paddingTop={1} flexDirection="row" gap={2}>
        <text fg={theme.text.muted} wrapMode="none" flexGrow={1} truncate>
          ↑↓ · space · ←→ · r · esc
        </text>
      </box>
    </box>
  )
}
