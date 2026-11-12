import { execFile } from "node:child_process"

export type ContentHit = {
  readonly path: string
  readonly line: number
  readonly text: string
}

export type ContentSearch = {
  readonly hits: readonly ContentHit[]
  readonly error?: string
  readonly truncated: boolean
}

const LIMIT = 300

function run(command: string, args: string[], cwd: string) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }),
    )
  })
}

const PER_FILE = 12

const parseGrep = (stdout: string): { hits: ContentHit[]; truncated: boolean } => {
  const hits: ContentHit[] = []
  const perFile = new Map<string, number>()
  let truncated = false
  for (const raw of stdout.split("\n")) {
    if (!raw) continue
    const match = /^(.+?):(\d+):(.*)$/.exec(raw)
    if (!match) continue
    const path = match[1].replace(/^\.\//, "")
    const count = (perFile.get(path) ?? 0) + 1
    perFile.set(path, count)
    if (count > PER_FILE) {
      truncated = true
      continue
    }
    hits.push({ path, line: Number(match[2]), text: match[3].replace(/\s+$/, "").slice(0, 400) })
    if (hits.length >= LIMIT) {
      truncated = true
      break
    }
  }
  return { hits, truncated }
}

/**
 * Content search that prefers `git grep` (respects .gitignore, fast on big
 * repos) and falls back to plain grep outside a repository.
 */
export async function searchContent(root: string, query: string, caseSensitive = false): Promise<ContentSearch> {
  const value = query.trim()
  if (value.length < 2) return { hits: [], truncated: false }

  const git = await run("git", ["grep", "--untracked", "-n", "-I", "--no-color", ...(caseSensitive ? [] : ["-i"]), "-e", value], root)
  if (git.ok || (!git.ok && git.stdout)) {
    const parsed = parseGrep(git.stdout)
    return { hits: parsed.hits, truncated: parsed.truncated }
  }

  const grep = await run(
    "grep",
    [
      "-rnI",
      "--binary-files=without-match",
      "--exclude-dir=node_modules",
      "--exclude-dir=.git",
      "--exclude-dir=dist",
      "--exclude-dir=build",
      ...(caseSensitive ? [] : ["-i"]),
      "-e",
      value,
      ".",
    ],
    root,
  )
  const parsed = parseGrep(grep.stdout)
  if (!grep.ok && grep.stderr && parsed.hits.length === 0) {
    return { hits: [], error: grep.stderr.trim().split("\n")[0], truncated: false }
  }
  return { hits: parsed.hits, truncated: parsed.truncated }
}
