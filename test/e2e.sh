#!/usr/bin/env bash
# End-to-end smoke test for the OpenCode file browser.
#
# Drives a real TUI inside tmux against a throwaway git fixture, then asserts on
# what is on screen and on disk. Requires: tmux, git, an `opencode` binary.
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
wait_for() {
  local pattern="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do
    cap | grep -q -- "$pattern" && return 0
    sleep 0.25
  done
  return 1
}
disk() { head -c 200 "$1" 2>/dev/null; }

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

say "== reset preferences to defaults (state is stored by the host, not the fixture)"
send F2
sleep 1.2
send r
sleep 0.5
send Escape
sleep 1

say "== expand folder and open a file"
send Home
send Enter
wait_for "app.ts" 20 || true
send Down
send Enter
sleep 1.5
expect "file content rendered" "export const greeting"
expect "line numbers" "  1 export const greeting"

say "== edit and save (ctrl+s)"
send "// note "
sleep 0.4
send C-s
sleep 1.5
if disk "$FIX/src/app.ts" | grep -q "// note export const greeting"; then
  say "PASS  edit saved to disk"
  pass=$((pass + 1))
else
  say "FAIL  edit saved to disk ($(disk "$FIX/src/app.ts"))"
  fail=$((fail + 1))
fi
expect "dirty marker cleared and git picked it up" "M src/app.ts"

say "== open a second file while the first stays open (old SyntaxStyle crash)"
send Escape
sleep 0.4
send End
send Enter
sleep 3
expect "two tabs open" "app.ts×"
expect "second tab open" "README.md×"
if cap | grep -q "NativeSyntaxStyle is destroyed"; then
  say "FAIL  switching files crashed the preview"
  fail=$((fail + 1))
else
  say "PASS  switching files keeps the preview alive"
  pass=$((pass + 1))
fi

say "== content search (ctrl+e)"
send C-e
sleep 0.6
send "needle"
sleep 1.5
expect "content search finds the hit" "src/util.ts:1"

say "== open the hit"
send Enter
sleep 1.5
expect "hit opens in a tab" "util.ts×"
expect "hit content visible" "needle in a haystack"

say "== large file"
send Escape
sleep 0.4
send Escape
sleep 0.4
send Home
send Down
send Down
send Down
send Enter
sleep 6
expect "large file opens read-only" "truncated for display"
expect "large file content" "row 000001"

say "== preferences (F2) and simple mode"
send Escape
sleep 0.4
send F2
sleep 1.5
expect "preferences dialog" "Preferences"
send Space
sleep 0.8
send Escape
sleep 1.2
expect "simple mode hides the changes panel" "simple"
send F2
sleep 1.2
send Space
sleep 0.6
send Escape
sleep 1

say "== git panel: stage and commit"
send C-g
sleep 1
send A
sleep 1.5
expect "changes staged" "staged"
send c
sleep 1
send "e2e commit"
sleep 0.6
send C-Enter
sleep 2.5
if git -C "$FIX" log --oneline | grep -q "e2e commit"; then
  say "PASS  commit created"
  pass=$((pass + 1))
else
  say "FAIL  commit created"
  fail=$((fail + 1))
fi

say "== restore default preferences"
send F2
sleep 1.2
send r
sleep 0.5
send Escape
sleep 0.8

say ""
say "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
