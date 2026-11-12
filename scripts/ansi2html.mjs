// ANSI (tmux capture-pane -e) -> standalone HTML, used to render the README
// screenshots with headless Chrome.
import { readFile, writeFile } from "node:fs/promises"

const [input, output, title = "OpenCode · files"] = process.argv.slice(2)
const source = await readFile(input, "utf8")

const escape = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

let fg = "#e6e6e6"
let bg = "#0a0a0a"
let bold = false
let dim = false
let italic = false
let underline = false
let out = ""

const reset = () => {
  fg = "#e6e6e6"
  bg = "#0a0a0a"
  bold = dim = italic = underline = false
}

const span = (char) => {
  if (char === "\n") return "<br>"
  const style = `color:${fg};background:${bg};${bold ? "font-weight:700;" : ""}${dim ? "opacity:.65;" : ""}${italic ? "font-style:italic;" : ""}${underline ? "text-decoration:underline;" : ""}`
  return `<span style="${style}">${escape(char)}</span>`
}

for (let index = 0; index < source.length; index++) {
  const char = source[index]
  if (char === "\u001b" && source[index + 1] === "[") {
    let end = index + 2
    while (end < source.length && !/[a-zA-Z]/.test(source[end])) end++
    const body = source.slice(index + 2, end)
    const command = source[end]
    if (command === "m") {
      const parts = body.split(";").map((value) => Number(value || 0))
      for (let part = 0; part < parts.length; part++) {
        const code = parts[part]
        if (code === 0) reset()
        else if (code === 1) bold = true
        else if (code === 2) dim = true
        else if (code === 3) italic = true
        else if (code === 4) underline = true
        else if (code === 22) bold = dim = false
        else if (code === 23) italic = false
        else if (code === 24) underline = false
        else if (code === 39) fg = "#e6e6e6"
        else if (code === 49) bg = "#0a0a0a"
        else if (code === 38 && parts[part + 1] === 2) {
          fg = `rgb(${parts[part + 2]},${parts[part + 3]},${parts[part + 4]})`
          part += 4
        } else if (code === 48 && parts[part + 1] === 2) {
          bg = `rgb(${parts[part + 2]},${parts[part + 3]},${parts[part + 4]})`
          part += 4
        }
      }
    }
    index = end
    continue
  }
  out += span(char)
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#111318; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .window { background:#0a0a0a; border:1px solid #23262e; border-radius:12px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.55); }
  .chrome { height:34px; display:flex; align-items:center; gap:8px; padding:0 14px; background:#14161c; border-bottom:1px solid #23262e; }
  .dot { width:10px; height:10px; border-radius:50%; }
  .title { margin-left:8px; font:500 12px/34px ui-monospace,SFMono-Regular,Menlo,monospace; color:#8b93a7; letter-spacing:.02em; }
  pre { margin:0; padding:16px 18px; font:14px/1.28 "JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace; color:#e6e6e6; background:#0a0a0a; }
</style></head>
<body><div class="window"><div class="chrome"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">${escape(title)}</span></div><pre>${out}</pre></div></body></html>`

await writeFile(output, html)
console.log(`wrote ${output}`)
