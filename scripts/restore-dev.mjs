import { rename } from "node:fs/promises"

await rename("package.json.bak", "package.json").catch(() => undefined)
console.log("restored package.json")
