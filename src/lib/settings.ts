import type { Plugin } from "@opencode/plugin/tui"

export type Settings = {
  /** Classic 0.3.x behavior: single file, list + preview, nothing else. */
  simple: boolean
  lineNumbers: boolean
  wrap: boolean
  tree: "expand" | "navigate"
  /** Preview the selected file inside the docked session panel. */
  panelPreview: boolean
  changes: boolean
  hidden: boolean
  mouse: boolean
  search: "name" | "content"
  caseSensitive: boolean
  confirmDiscard: boolean
}

export const DEFAULTS: Settings = {
  simple: false,
  lineNumbers: true,
  wrap: false,
  tree: "expand",
  panelPreview: true,
  changes: true,
  hidden: false,
  mouse: true,
  search: "name",
  caseSensitive: false,
  confirmDiscard: true,
}

export type SettingsStore = {
  readonly value: () => Settings
  readonly update: (mutation: (draft: Settings) => void) => Promise<void>
  readonly reset: () => Promise<void>
}

export function useSettings(context: Plugin.Context): SettingsStore {
  const [store, update] = context.storage.store<Settings>("settings", { initial: DEFAULTS })
  const value = () => {
    const merged = { ...DEFAULTS, ...store }
    // Older builds stored `collapsed` / `all`; keep those users working.
    if ((merged.tree as string) === "collapsed" || (merged.tree as string) === "all") merged.tree = "expand"
    return merged
  }
  return {
    value,
    update,
    reset: () =>
      update((draft) => {
        Object.assign(draft, DEFAULTS)
      }),
  }
}
