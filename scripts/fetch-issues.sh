#!/usr/bin/env bash
# Fetches every anthropics/claude-code (or, with --agent codex, openai/codex) issue (all states) with each label into <out>/issues-<label>.json.
# Usage: bash scripts/fetch-issues.sh [--agent claude|codex] [out-dir, default <repo>/data, or <repo>/data/codex for codex]. Needs gh (logged in) and node.
# Pages are fetched oldest first, one by one, so a failure names the page; each file is replaced only on success.
set -euo pipefail
agent=claude out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) [ $# -ge 2 ] || { echo "usage: fetch-issues.sh [--agent claude|codex] [out-dir]" >&2; exit 1; }; agent="$2"; shift 2 ;;
    *) out="$1"; shift ;;
  esac
done
case "$agent" in
  claude) repo=anthropics/claude-code labels="area:model data-loss"; data="$(dirname "$0")/../data" ;;
  # openai/codex has no area:model or data-loss. Edit this line to change the labels (scripts/mine-issues.ts reads whatever files are here).
  # model-behavior is the area:model analogue; tool-calls, context, agent and subagent hold the behaviours an AGENTS.md rule can change.
  codex) repo=openai/codex labels="model-behavior tool-calls context agent subagent"; data="$(dirname "$0")/../data/codex" ;;
  *) echo "usage: fetch-issues.sh [--agent claude|codex] [out-dir]" >&2; exit 1 ;;
esac
out="${out:-$data}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

COUNT='const a = JSON.parse(require("fs").readFileSync(0, "utf8")); if (!Array.isArray(a)) process.exit(1); console.log(a.length)'
JOIN='const fs = require("fs"); process.stdout.write(JSON.stringify(process.argv.slice(1).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")))))'

pages="" tmpfile=""
trap 'rm -rf "$pages" "$tmpfile"' EXIT
trap 'exit 130' INT TERM

for label in $labels; do
  pages="$(mktemp -d)" tmpfile="$out/.issues-$label.json.tmp"
  page=1
  while :; do
    f="$pages/$(printf %04d "$page").json"
    if ! gh api "repos/$repo/issues?labels=$label&state=all&sort=created&direction=asc&per_page=100&page=$page" >"$f"; then
      echo "fetch failed: label $label, page $page; $out/issues-$label.json left unchanged" >&2
      exit 1
    fi
    if ! n="$(node -e "$COUNT" <"$f")"; then
      echo "fetch failed: label $label, page $page is not a JSON array; $out/issues-$label.json left unchanged" >&2
      exit 1
    fi
    if [ "$n" -lt 100 ]; then break; fi
    page=$((page + 1))
  done
  node -e "$JOIN" "$pages"/*.json >"$tmpfile"
  mv "$tmpfile" "$out/issues-$label.json"
  rm -rf "$pages"
  echo "$label: $(node -e "$COUNT" <"$out/issues-$label.json") items, $page pages"
done
date -u +%Y-%m-%d >"$out/fetched-at.txt"
