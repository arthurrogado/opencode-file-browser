#!/usr/bin/env bash
# Second end-to-end pass: the edge cases that need their own fresh state.
# Covers editor colours, help, hidden files, name search, open-by-path with a
# space, preference persistence and the context-menu file creation.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=/tmp/opencode/ofb-extra
FIX="$BASE/proj"
XDG="$BASE/config"
SESSION=ofb-extra
OPENCODE_BIN=${OPENCODE_BIN:-opencode}
pass=0
fail=0

say() { printf '%s\n' "$*"; }
send() { tmux send-keys -t "$SESSION" "$@"; }
cap() { tmux capture-pane -p -t "$SESSION" 2>/dev/null; }
cap_ansi() { tmux capture-pane -p -e -t "$SESSION" 2>/dev/null; }
expect() {
  local name="$1" pattern="$2"
  if cap | grep -q -- "$pattern"; then say "PASS  $name"; pass=$((pass + 1)); else
    say "FAIL  $name  (missing: $pattern)"; cap | tail -20 >&2; fail=$((fail + 1)); fi
}
refute() {
  local name="$1" pattern="$2"
  if cap | grep -q -- "$pattern"; then say "FAIL  $name  (unexpected: $pattern)"; fail=$((fail + 1)); else
    say "PASS  $name"; pass=$((pass + 1)); fi
}
wait_for() {
  local pattern="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do cap | grep -q -- "$pattern" && return 0; sleep 0.25; done
  return 1
}
reset_prefs() { send F2; wait_for "Preferences" 30 || true; sleep 0.4; send r; sleep 0.5; send Escape; sleep 0.9; }
cleanup() { [ "${KEEP:-0}" = "1" ] || tmux kill-session -t "$SESSION" 2>/dev/null; }
trap cleanup EXIT

command -v tmux >/dev/null || exit 2
rm -rf "$BASE"
mkdir -p "$FIX/src" "$XDG/opencode"
printf 'export const greeting = "Hello"\nexport function add(a: number, b: number) { return a + b }\n' > "$FIX/src/app.ts"
printf 'needle in a haystack\n' > "$FIX/src/util.ts"
printf 'secret notes\n' > "$FIX/.secret.md"
printf 'spaced out\n' > "$FIX/space name.md"
printf '# Demo\n' > "$FIX/README.md"
git -C "$FIX" init -q
git -C "$FIX" config user.email e2e@example.com
git -C "$FIX" config user.name e2e
git -C "$FIX" add -A && git -C "$FIX" commit -qm fixture
printf '{"$schema":"https://opencode.ai/v2/cli.json","plugins":["%s"]}\n' "$ROOT" > "$XDG/opencode/cli.json"

(cd "$ROOT" && npm run bundle >/dev/null) || exit 2
tmux kill-session -t "$SESSION" 2>/dev/null
tmux new-session -d -s "$SESSION" -x 160 -y 42 "cd '$FIX' && XDG_CONFIG_HOME='$XDG' '$OPENCODE_BIN' 2>/tmp/opencode/ofb-extra.log"
sleep 8
send C-x f
wait_for "Explorer" || true
reset_prefs

say "== open the editor"
send Home
send Enter
sleep 0.6
send Down
send Enter
sleep 1.8
expect "app.ts open" "export const greeting"

say "== syntax colours survive editing"
line=$(cap_ansi | grep -m1 "export const greeting")
colours=$(printf '%s' "$line" | grep -o "38;2;[0-9;]*" | sort -u | wc -l)
if [ "$colours" -ge 3 ]; then say "PASS  three or more colours ($colours)"; pass=$((pass + 1)); else say "FAIL  three or more colours ($colours)"; fail=$((fail + 1)); fi

say "== help dialog"
send F1
wait_for "Keyboard shortcuts" 20 || true
expect "help lists the tab shortcut" "Close the current tab"
send Escape
sleep 0.6

say "== hidden files"
send Escape
sleep 0.4
refute "dotfiles hidden by default" "secret.md"
send h
sleep 1.2
expect "h shows dotfiles" "secret.md"
send h
sleep 1

say "== name search"
send C-f
sleep 0.6
send "util.ts"
sleep 1.5
expect "name search finds the file" "util.ts"
send Enter
sleep 1.5
expect "name search opens the hit" "needle in a haystack"
send C-w
sleep 1

say "== open by path with a space"
send C-x o
wait_for "Open file by path" 25 || true
sleep 0.4
send "$FIX/space name.md"
sleep 0.4
send Enter
sleep 1.8
expect "path with spaces opens" "spaced out"
send C-w
sleep 1

say "== navigate mode has no dead end"
send S-Tab
sleep 0.4
send F2
wait_for "Preferences" 25 || true
sleep 0.3
send Home
send Down
send Down
send Down
sleep 0.2
send Right
sleep 0.5
send Escape
sleep 1
send Escape
sleep 0.4
send Home
sleep 0.3
send Enter
sleep 1.2
expect "navigate enters the folder" "/proj/src"
expect "navigate shows the parent row" "↰ .."
send S-Enter
sleep 1.2
expect "collapse returns to the project root" "3 items"
expect "root listing is back" "src/"
send Home
sleep 0.3
send Enter
sleep 1.2
expect "entered again" "/proj/src"
send Home
sleep 0.3
send Enter
sleep 1.2
expect "the .. row goes up" "3 items"
send F2
wait_for "Preferences" 25 || true
sleep 0.3
send Home
send Down
send Down
send Down
sleep 0.2
send Left
sleep 0.5
send Escape
sleep 1

say "== context menu creates a file"
send S-Tab
sleep 0.4
send F10
wait_for "New file" 20 || true
sleep 0.3
send Enter
wait_for "inside" 20 || true
sleep 0.3
send "created.txt"
sleep 0.3
send Enter
sleep 1.5
if [ -f "$FIX/created.txt" ] || [ -f "$FIX/src/created.txt" ]; then say "PASS  context menu created the file"; pass=$((pass + 1)); else say "FAIL  context menu created the file"; fail=$((fail + 1)); fi
expect "created file appears in the tree" "created.txt"
expect "footer keeps the shortcuts while a status is shown" "↑↓ move"

say "== file context menu offers copy and move"
send Home
sleep 0.3
send F10
wait_for "Move to" 20 || true
expect "context menu has copy" "Copy"
expect "context menu has move" "Move to"
send Escape
sleep 0.6

say "== wrap hides the line numbers"
send C-w
sleep 1
send F2
wait_for "Preferences" 30 || true
sleep 0.6
send Home
sleep 0.2
send Down
send Down
sleep 0.3
send Space
sleep 0.8
send Escape
sleep 1.2
refute "wrap removed the gutter" "  1 export const greeting"
send F2
wait_for "Preferences" 30 || true
sleep 0.6
send Home
sleep 0.2
send Down
send Down
sleep 0.3
send Space
sleep 0.8
send Escape
sleep 1.2
expect "unwrapping brings the gutter back" "  1 export const greeting"

say "== line numbers preference persists across reopen"
send F2
wait_for "Preferences" 25 || true
sleep 0.3
send Home
send Down
sleep 0.2
send Space
sleep 0.5
send Escape
sleep 1
send Escape
sleep 0.4
send C-x f
wait_for "Explorer" 25 || true
sleep 1
refute "line numbers stayed off" "  1 export const greeting"
reset_prefs

say ""
say "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
