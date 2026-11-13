import { parentOf, type Entry } from "./util.js"

export type NavRow = {
  readonly path: string
  readonly type: "file" | "directory"
  readonly depth: number
  /** The synthetic ".." entry shown at the top of a navigate listing. */
  readonly parent?: boolean
}

export const isNavigate = (tree: string) => tree === "navigate"

/**
 * Rows for navigate mode: the contents of `root`, prefixed by a ".." entry when
 * the user is inside a folder. Keeping this pure makes the dead-end rules
 * testable without a TUI.
 */
export function navigateRows(root: string, entries: readonly Entry[]): NavRow[] {
  const rows: NavRow[] = entries.map((entry) => ({ path: entry.path, type: entry.type, depth: 0 }))
  if (!root) return rows
  return [{ path: "..", type: "directory", depth: 0, parent: true }, ...rows]
}

/** Where "go up" lands: the parent folder, or the project root when `all`. */
export const upTarget = (root: string, all = false) => (all ? "" : parentOf(root))

/**
 * Where the collapse shortcut lands. In navigate mode it means "back to the
 * project root" (the tree state is irrelevant there); in expand mode the
 * caller collapses the tree instead and this returns null.
 */
export const collapseTarget = (tree: string, root: string) => (isNavigate(tree) ? upTarget(root, true) : null)
