import path from "node:path"
import { homedir } from "node:os"

// Soft caps for what we hand to the renderer. The editor and the preview both
// stay responsive below these; above them the file opens in a plain, unhighlighted
// window instead of freezing the TUI.
export const MAX_LINES = 2_000
export const MAX_CHARS = 4 * 1024 * 1024
export const MAX_LINE_CHARS = 4_000
// Above this size highlighting is disabled and the file is rendered as plain text.
export const HEAVY_LINES = 5_000
// Above this the renderer is fed a placeholder instead of the buffer: huge
// inputs can starve the TUI event loop and the host then stops routing keys to
// the plugin.
export const OVERSIZE_LINES = 20_000
export const OVERSIZE_BYTES = 2 * 1024 * 1024
export const HEAVY_CHARS = 512 * 1024

export type Entry = { readonly path: string; readonly type: "file" | "directory" }

export const EXTENSIONS: Record<string, string> = {
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

export const expandHome = (value: string) => {
  if (value === "~") return homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2))
  return value
}

export const basename = (value: string) => {
  const trimmed = value.replace(/\/+$/, "")
  const index = trimmed.lastIndexOf("/")
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

export const dirname = (value: string) => {
  const index = value.lastIndexOf("/")
  return index === -1 ? "" : value.slice(0, index)
}

export const extname = (value: string) => {
  const name = basename(value).toLowerCase()
  const index = name.lastIndexOf(".")
  return index <= 0 ? "" : name.slice(index)
}

export const filetype = (value: string) => {
  const name = basename(value).toLowerCase()
  if (name === "makefile") return "makefile"
  if (name === "dockerfile") return "dockerfile"
  if (name === ".gitignore") return "gitignore"
  return EXTENSIONS[extname(value)] ?? "text"
}

export const isMarkdown = (value: string) => {
  const ext = extname(value)
  return ext === ".md" || ext === ".markdown" || ext === ".mdx"
}

export const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

// Some native text buffers cannot handle pathologically long lines; clip them
// instead of risking a renderer failure on minified bundles or data files.
export const clampLongLines = (text: string) => {
  let clipped = false
  const lines = text.split("\n").map((line) => {
    if (line.length <= MAX_LINE_CHARS) return line
    clipped = true
    return line.slice(0, MAX_LINE_CHARS) + " …"
  })
  return { text: lines.join("\n"), clipped }
}

export const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export const isBinary = (bytes: Uint8Array) => {
  const limit = Math.min(bytes.length, 8000)
  for (let index = 0; index < limit; index++) if (bytes[index] === 0) return true
  return false
}

export const parentOf = (value: string) => {
  const index = value.lastIndexOf("/")
  return index === -1 ? "" : value.slice(0, index)
}

export const truncate = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

export const unique = <T,>(values: T[]) => [...new Set(values)]

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
