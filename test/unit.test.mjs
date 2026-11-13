// Unit tests for the navigation rules that caused the "stuck in navigate mode"
// bug: a parent row when inside a folder, go-up targets, and collapse meaning
// "back to the project root" in navigate mode. They run against the built
// modules, so they cover exactly what ships.
import test from "node:test"
import assert from "node:assert/strict"

const { navigateRows, upTarget, collapseTarget, isNavigate } = await import("../dist/lib/navigation.js")

const entries = [
  { path: "src/app.ts", type: "file" },
  { path: "src/lib", type: "directory" },
]

test("navigateRows at the project root has no parent row", () => {
  const rows = navigateRows("", entries)
  assert.equal(rows.length, 2)
  assert.equal(rows.some((row) => row.parent), false)
  assert.deepEqual(
    rows.map((row) => row.path),
    ["src/app.ts", "src/lib"],
  )
})

test("navigateRows inside a folder prepends a '..' parent row", () => {
  const rows = navigateRows("src", entries)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], { path: "..", type: "directory", depth: 0, parent: true })
  assert.deepEqual(
    rows.slice(1).map((row) => row.path),
    ["src/app.ts", "src/lib"],
  )
})

test("navigateRows never mutates the caller's entries", () => {
  navigateRows("src", entries)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].path, "src/app.ts")
})

test("upTarget walks one level and stops at the root", () => {
  assert.equal(upTarget("src/lib"), "src")
  assert.equal(upTarget("src"), "")
  assert.equal(upTarget(""), "")
})

test("upTarget with all=true always lands on the project root", () => {
  assert.equal(upTarget("src/lib", true), "")
  assert.equal(upTarget("src", true), "")
  assert.equal(upTarget("", true), "")
})

test("collapse in navigate mode targets the project root", () => {
  assert.equal(collapseTarget("navigate", "src/lib"), "")
  assert.equal(collapseTarget("navigate", ""), "")
})

test("collapse in expand mode leaves the tree to the caller", () => {
  assert.equal(collapseTarget("expand", "src/lib"), null)
  assert.equal(collapseTarget("expand", ""), null)
})

test("only the navigate value enables navigation mode", () => {
  assert.equal(isNavigate("navigate"), true)
  assert.equal(isNavigate("expand"), false)
  assert.equal(isNavigate("collapsed"), false)
  assert.equal(isNavigate("all"), false)
})
