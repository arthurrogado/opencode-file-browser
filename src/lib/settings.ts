import type { Plugin } from "@opencode/plugin/tui"

export type Settings = {
  /** Classic 0.3.x behavior: single file, list + preview, nothing else. */
  simple: boolean
  lineNumbers: boolean
  wrap: boolean
  tree: "collapsed" | "all"
  /** Preview the selected file inside the docked session panel. */
  panelPreview: boolean
  changes: boolean
  hidden: boolean
  mouse: boolean
  search: "name" | "content"
  confirmDiscard: boolean
  tabWidth: number
}

export const DEFAULTS: Settings = {
  simple: false,
  lineNumbers: true,
  wrap: false,
  tree: "collapsed",
  panelPreview: true,
  changes: true,
  hidden: false,
  mouse: true,
  search: "name",
  confirmDiscard: true,
  tabWidth: 2,
}

export type SettingsStore = {
  readonly value: () => Settings
  readonly update: (mutation: (draft: Settings) => void) => Promise<void>
  readonly reset: () => Promise<void>
}

export function useSettings(context: Plugin.Context): SettingsStore {
  const [store, update] = context.storage.store<Settings>("settings", { initial: DEFAULTS })
  return {
    value: () => ({ ...DEFAULTS, ...store }),
    update,
    reset: () =>
      update((draft) => {
        Object.assign(draft, DEFAULTS)
      }),
  }
}
