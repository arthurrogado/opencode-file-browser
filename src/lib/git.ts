import { execFile } from "node:child_process"

export type GitChange = {
  readonly path: string
  /** Status letter in the index, e.g. "M", "A", "?", " ". */
  readonly index: string
  /** Status letter in the working tree. */
  readonly worktree: string
  /** Normalised display status. */
  readonly status: "added" | "deleted" | "modified" | "renamed" | "untracked" | "conflicted"
  readonly staged: boolean
  readonly additions?: number
  readonly deletions?: number
}

export type GitState = {
  readonly repo: boolean
  readonly branch: string
  readonly changes: readonly GitChange[]
  readonly staged: number
  readonly unstaged: number
  readonly error?: string
}

const EMPTY: GitState = { repo: false, branch: "", changes: [], staged: 0, unstaged: 0 }

export function git(root: string, args: string[], timeout = 20_000) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "git",
      ["-c", "color.status=false", "-c", "core.quotepath=false", ...args],
      { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }),
    )
  })
}

const normalise = (index: string, worktree: string): GitChange["status"] => {
  const code = `${index}${worktree}`
  if (code.includes("U") || code === "AA" || code === "DD") return "conflicted"
  if (index === "?" || worktree === "?") return "untracked"
  if (index === "R" || worktree === "R") return "renamed"
  if (index === "A" || worktree === "A") return "added"
  if (index === "D" || worktree === "D") return "deleted"
  return "modified"
}

export async function status(root: string): Promise<GitState> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout.trim() !== "true") return EMPTY
  const head = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  const branchResult = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  const changes: GitChange[] = []
  const parts = head.stdout.split("\0")
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index]
    if (!item || item.length < 4) continue
    const indexStatus = item[0]
    const worktreeStatus = item[1]
    const target = item.slice(3)
    // Renames and copies carry the original path in the next NUL-separated slot.
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") index++
    changes.push({
      path: target,
      index: indexStatus,
      worktree: worktreeStatus,
      status: normalise(indexStatus, worktreeStatus),
      staged: indexStatus !== " " && indexStatus !== "?",
    })
  }
  changes.sort((a, b) => a.path.localeCompare(b.path))
  return {
    repo: true,
    branch: branchResult.ok ? branchResult.stdout.trim() : "detached",
    changes,
    staged: changes.filter((change) => change.staged).length,
    unstaged: changes.filter((change) => !change.staged).length,
    error: head.ok ? undefined : head.stderr.trim() || "git status failed",
  }
}

export async function stage(root: string, path?: string) {
  return git(root, path ? ["add", "--", path] : ["add", "-A"])
}

export async function unstage(root: string, path?: string) {
  return git(root, path ? ["restore", "--staged", "--", path] : ["restore", "--staged", "."])
}

export async function discard(root: string, change: GitChange) {
  if (change.status === "untracked") return git(root, ["clean", "-fd", "--", change.path])
  return git(root, ["checkout", "--", change.path])
}

export async function commit(root: string, message: string) {
  return git(root, ["commit", "-m", message])
}

export async function pull(root: string) {
  return git(root, ["pull", "--ff-only"], 120_000)
}

export async function push(root: string) {
  return git(root, ["push"], 120_000)
}

export async function branches(root: string) {
  const result = await git(root, ["branch", "--format=%(refname:short)"])
  return result.ok ? result.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : []
}

export async function log(root: string, limit = 30) {
  const result = await git(root, ["log", `-${limit}`, "--pretty=format:%h %ad %s", "--date=short"])
  return result.ok ? result.stdout.split("\n").filter(Boolean) : []
}

export const isGitRepo = async (root: string) => (await status(root)).repo
