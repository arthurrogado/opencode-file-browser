import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const source = await readFile("src/tui.tsx", "utf8")
const result = await transformAsync(source, {
  filename: "src/tui.tsx",
  configFile: false,
  babelrc: false,
  // Same transform the host uses for local TUI plugins, so the published
  // output has explicit imports the runtime can rewrite to host modules.
  presets: [
    [solid, { moduleName: "@opentui/solid", generate: "universal" }],
    [ts, {}],
  ],
})

if (!result?.code) throw new Error("Babel produced no output")

await mkdir("dist", { recursive: true })
await writeFile("dist/tui.js", result.code)
console.log("built dist/tui.js")
