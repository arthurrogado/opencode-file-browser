import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

async function sources(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sources(target)))
    else if (/\.tsx?$/.test(entry.name)) found.push(target)
  }
  return found
}

const files = await sources("src")
for (const file of files) {
  const source = await readFile(file, "utf8")
  const result = await transformAsync(source, {
    filename: file,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    // Same transform the host uses for local TUI plugins, so the published
    // output has explicit imports the runtime can rewrite to host modules.
    presets: [
      [solid, { moduleName: "@opentui/solid", generate: "universal" }],
      [ts, {}],
    ],
  })
  if (!result?.code) throw new Error(`Babel produced no output for ${file}`)
  const output = path.join("dist", path.relative("src", file)).replace(/\.tsx?$/, ".js")
  await mkdir(path.dirname(output), { recursive: true })
  // Write-then-rename: the host watches the plugin directory and can reconcile
  // at any moment. A half-written module makes that reconciliation fail and
  // leaves the plugin's keymaps dead until the TUI restarts.
  const temporary = `${output}.${process.pid}.tmp`
  await writeFile(temporary, result.code)
  await rename(temporary, output)
  console.log(`built ${output}`)
}
