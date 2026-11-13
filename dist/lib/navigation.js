import { parentOf } from "./util.js";
export const isNavigate = tree => tree === "navigate";

/**
 * Rows for navigate mode: the contents of `root`, prefixed by a ".." entry when
 * the user is inside a folder. Keeping this pure makes the dead-end rules
 * testable without a TUI.
 */
export function navigateRows(root, entries) {
  const rows = entries.map(entry => ({
    path: entry.path,
    type: entry.type,
    depth: 0
  }));
  if (!root) return rows;
  return [{
    path: "..",
    type: "directory",
    depth: 0,
    parent: true
  }, ...rows];
}

/** Where "go up" lands: the parent folder, or the project root when `all`. */
export const upTarget = (root, all = false) => all ? "" : parentOf(root);

/**
 * Where the collapse shortcut lands. In navigate mode it means "back to the
 * project root" (the tree state is irrelevant there); in expand mode the
 * caller collapses the tree instead and this returns null.
 */
export const collapseTarget = (tree, root) => isNavigate(tree) ? upTarget(root, true) : null;