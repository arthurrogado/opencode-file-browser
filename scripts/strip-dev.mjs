// npm runs this before packing: the published package must not carry the build
// toolchain, because the host installs plugins with `npm install --include=dev`.
import { readFile, rename, writeFile } from "node:fs/promises"

await rename("package.json", "package.json.bak")
const data = JSON.parse(await readFile("package.json.bak", "utf8"))
delete data.devDependencies
await writeFile("package.json", `${JSON.stringify(data, null, 2)}\n`)
console.log("packaging without devDependencies")
