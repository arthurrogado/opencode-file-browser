#!/usr/bin/env bash
# End-to-end smoke test for the OpenCode file browser.
#
# Drives a real TUI inside tmux against a throwaway git fixture, then asserts on
# what is on screen, on disk and in git. Requires: tmux, git, an `opencode`
# binary, a terminal with mouse reporting disabled (default).
#
#   ./test/e2e.sh              # full run
#   KEEP=1 ./test/e2e.sh       # leave the tmux session alive for inspection
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=/tmp/opencode/ofb-e2e
FIX="$BASE/proj"
XDG="$BASE/config"
SESSION=ofb-e2e
OPENCODE_BIN=${OPENCODE_BIN:-opencode}
pass=0
fail=0

say() { printf '%s\n' "$*"; }
send() { tmux send-keys -t "$SESSION" "$@"; }
cap() { tmux capture-pane -p -t "$SESSION" 2>/dev/null; }
cap_ansi() { tmux capture-pane -p -e -t "$SESSION" 2>/dev/null; }
expect() {
  local name="$1" pattern="$2"
  if cap | grep -q -- "$pattern"; then
    say "PASS  $name"
    pass=$((pass + 1))
  else
    say "FAIL  $name  (missing: $pattern)"
    cap | tail -25 >&2
    fail=$((fail + 1))
  fi
}
refute() {
  local name="$1" pattern="$2"
  if cap | grep -q -- "$pattern"; then
    say "FAIL  $name  (unexpected: $pattern)"
    fail=$((fail + 1))
  else
    say "PASS  $name"
    pass=$((pass + 1))
  fi
}
wait_for() {
  local pattern="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do
    cap | grep -q -- "$pattern" && return 0
    sleep 0.25
  done
  return 1
}
disk() { head -c 300 "$1" 2>/dev/null; }
reset_prefs() {
  send F2
  wait_for "Preferences" 30 || true
  sleep 0.4
  send r
  sleep 0.5
  send Escape
  sleep 0.9
}

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then tmux kill-session -t "$SESSION" 2>/dev/null; fi
}
trap cleanup EXIT

command -v tmux >/dev/null || { say "tmux is required"; exit 2; }
command -v git >/dev/null || { say "git is required"; exit 2; }

say "== build"
(cd "$ROOT" && npm run bundle >/dev/null) || { say "build failed"; exit 2; }

say "== fixture"
rm -rf "$BASE"
mkdir -p "$FIX/src" "$XDG/opencode"
printf 'export const greeting = "Hello"\nexport function add(a: number, b: number) { return a + b }\n' > "$FIX/src/app.ts"
printf '# Demo\n\nSome text here.\n' > "$FIX/README.md"
printf 'needle in a haystack\n' > "$FIX/src/util.ts"
printf 'NEEDLE in caps\n' > "$FIX/src/caps.ts"
seq -f "row %06g" 1 200000 > "$FIX/big.log"
git -C "$FIX" init -q
git -C "$FIX" config user.email e2e@example.com
git -C "$FIX" config user.name e2e
git -C "$FIX" add -A
git -C "$FIX" commit -qm "fixture"
printf '{"$schema":"https://opencode.ai/v2/cli.json","plugins":["%s"]}\n' "$ROOT" > "$XDG/opencode/cli.json"

say "== boot"
tmux kill-session -t "$SESSION" 2>/dev/null
tmux new-session -d -s "$SESSION" -x 200 -y 45 "cd '$FIX' && XDG_CONFIG_HOME='$XDG' '$OPENCODE_BIN' 2>/tmp/opencode/ofb-e2e.log"
sleep 8

say "== open browser (ctrl+x f)"
send C-x f
wait_for "Explorer" || true
expect "browser opens" "Explorer"

say "== reset preferences to defaults (host storage is global)"
reset_prefs

say "== expand folder and open a file"
send Home
send Enter
wait_for "app.ts" 20 || true
send Down
send Enter
sleep 1.5
expect "file content rendered" "export const greeting"
expect "line numbers" "  1 export const greeting"
expect "editor scrollbar" "░"

say "== edit: plain typing, Enter inserts a new line, save writes both"
send "// e2e "
sleep 0.4
send Enter
sleep 0.4
send "second line"
sleep 0.6
expect "new line created with Enter" "second line"
send C-s
sleep 1.5
if disk "$FIX/src/app.ts" | grep -q "second line"; then
  say "PASS  save wrote the edited buffer"
  pass=$((pass + 1))
else
  say "FAIL  save wrote the edited buffer ($(disk "$FIX/src/app.ts"))"
  fail=$((fail + 1))
fi
expect "git sees the modification" "M src/app.ts"

say "== focus round-trip: leave the editor and come back"
send Escape
sleep 0.4
send Tab
sleep 0.8
send "R"
sleep 0.8
expect "typing works after Escape/Tab" "R"
send Escape
sleep 0.3
send Tab
sleep 0.5

say "== preferences round-trip keeps edit focus"
send F2
sleep 1.1
send Escape
sleep 1
send "S"
sleep 0.8
expect "typing works after the preferences dialog" "S"
send C-s
sleep 1

say "== tabs survive closing and reopening the browser"
send Escape
sleep 0.4
send Escape
sleep 1.2
refute "browser closed" "Explorer"
send C-x f
sleep 2.5
expect "tabs restored after reopening" "app.ts×"
expect "document content restored" "export const greeting"

say "== diff view for a modified file"
send C-g
sleep 1
send Enter
sleep 2
expect "diff tab opens" "Δ app.ts"
expect "diff shows a removed line" " - "
expect "diff shows an added line" "+ "

say "== tab actions menu (F10, same code path as right click)"
send F10
sleep 1.2
expect "tab actions menu opens" "Close other tabs"
expect "menu offers close all" "Close all tabs"
send Escape
sleep 0.6

say "== navigate mode: opening a folder replaces the listing"
send F2
sleep 1.1
send Home
sleep 0.3
send Down
send Down
send Down
sleep 0.3
send Right
sleep 0.5
send Escape
sleep 0.9
send S-Tab
sleep 0.4
send Home
sleep 0.3
send Enter
sleep 1.2
expect "navigate mode shows the folder in the header" "/proj/src"
expect "navigate mode lists the folder contents" "app.ts"
send Backspace
sleep 1
expect "backspace returns to the project root" "3 items"
send F2
sleep 1.1
send Home
sleep 0.3
send Down
send Down
send Down
sleep 0.3
send Left
sleep 0.5
send Escape
sleep 0.9

say "== case sensitive search"
send F2
sleep 1.1
send Home
sleep 0.3
send Down
send Down
send Down
send Down
send Down
send Down
send Down
send Down
send Down
sleep 0.3
send Space
sleep 0.5
send Escape
sleep 0.9
send C-e
sleep 0.5
send "NEEDLE"
sleep 1.5
expect "case sensitive search keeps only the uppercase hit" "src/caps.ts"
refute "case sensitive search hides the lowercase hit" "src/util.ts"
send Escape
sleep 0.5
send C-f
sleep 0.5
send "needle"
sleep 1.5
expect "lowercase query still finds cases" "src/util.ts"

say "== large file"
send Escape
sleep 0.6
send Home
send Down
send Enter
sleep 4
expect "large file shows the placeholder" "too large to render"
expect "large file reports its size" "lines · text"
send F2
sleep 1.2
expect "keymap survives a large file" "Preferences"
send Escape
sleep 0.7

say "== preferences: simple mode hides the changes panel"
send F2
wait_for "Preferences" 30 || true
sleep 0.4
send Home
sleep 0.3
send Space
sleep 0.8
send Escape
sleep 1.2
expect "simple mode hides the changes panel" "simple"
reset_prefs

say "== git panel: stage and commit"
send C-g
sleep 1
send A
sleep 1.5
expect "changes staged" "staged"
send c
wait_for "Commit message" 20 || true
sleep 0.4
send "e2e commit"
sleep 0.6
send C-Enter
sleep 3
if git -C "$FIX" log --oneline | grep -q "e2e commit"; then
  say "PASS  commit created"
  pass=$((pass + 1))
else
  say "FAIL  commit created"
  fail=$((fail + 1))
fi

say "== changes footer is not clipped"
expect "footer keeps discard" "d discard"
expect "footer keeps refresh" "R"

say "== restore default preferences"
reset_prefs

say ""
say "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
