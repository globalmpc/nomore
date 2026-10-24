# Security

## What nomore reads

- Claude Code transcripts: `<config>/projects/*/*.jsonl`, where `<config>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`.
- `CLAUDE.md` files: `<config>/CLAUDE.md`, and `<project>/CLAUDE.md` with `--project`.

## What nomore writes

- Nothing, unless you run `--apply` and answer yes (or edit) for a rule. Then only:
  - the chosen `CLAUDE.md` (`<project>/CLAUDE.md` with `--project`, else `<config>/CLAUDE.md`), atomically, never
    removing or changing existing lines;
  - `<config>/nomore/adopted.json`, a log of the rules you adopted.

## Network

None. nomore makes no network requests. Transcript text is shown only in your terminal; `--card` output has no quotes
or file paths.

## Reporting a problem

Please open a GitHub issue, or for anything sensitive, contact the maintainers privately before posting details.
