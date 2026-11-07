#!/bin/sh
set -eu

destination="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/file-browser"

mkdir -p "$(dirname "$destination")"

if [ -d "$destination/.git" ]; then
  git -C "$destination" pull --ff-only
else
  rm -rf "$destination"
  git clone --depth 1 https://github.com/arthurrogado/opencode-file-browser.git "$destination"
fi

printf 'opencode-file-browser installed at %s\n' "$destination"
printf 'Restart OpenCode (or run /reload) to load it.\n'
