## nomore rules

- Don't add code comments unless they explain something non-obvious; match the comment density of the surrounding code, and stop when asked.
  1 issue · 252 reactions · [#65961](https://github.com/anthropics/claude-code/issues/65961)
- Don't use the word "load-bearing" or other recurring jargon; say what you mean in plain words.
  1 issue · 185 reactions · [#53454](https://github.com/anthropics/claude-code/issues/53454)
- Never run destructive git commands (`reset --hard`, `checkout -- .`, `clean -f`, `push --force`) or schedule them without explicit permission.
  1 issue · 121 reactions · [#40710](https://github.com/anthropics/claude-code/issues/40710)
- Keep typographic characters (curly quotes, em dashes, ellipses) exactly as written; don't replace them with ASCII.
  1 issue · 61 reactions · [#1599](https://github.com/anthropics/claude-code/issues/1599)
- Don't use the idiom "belt-and-suspenders"; vary phrasing and keep it literal.
  1 issue · 43 reactions · [#61462](https://github.com/anthropics/claude-code/issues/61462)
- If exploring or thinking isn't converging, stop, report what you found, and ask instead of looping.
  1 issue · 38 reactions · [#24585](https://github.com/anthropics/claude-code/issues/24585)
- In plan mode, never edit files or run commands that change state; only read and propose.
  1 issue · 38 reactions · [#38255](https://github.com/anthropics/claude-code/issues/38255)
- Avoid shell command substitution (`$(...)`); run the steps as separate commands so each can be approved.
  1 issue · 33 reactions · [#31373](https://github.com/anthropics/claude-code/issues/31373)
- Always reply in the user's language, even right after reading tool output in another language.
  1 issue · 30 reactions · [#96326](https://github.com/anthropics/claude-code/issues/96326)
- With ripgrep, never pass `-r` (it means `--replace`); use `rg -n` for line numbers.
  1 issue · 29 reactions · [#62016](https://github.com/anthropics/claude-code/issues/62016)
- Keep non-ASCII characters (ä, ö, ü, ß, and any other script) exactly as written; never transliterate them.
  1 issue · 26 reactions · [#14131](https://github.com/anthropics/claude-code/issues/14131)
- Write accessible UI code by default: semantic HTML, labels for inputs, keyboard support and sufficient contrast.
  1 issue · 26 reactions · [#56079](https://github.com/anthropics/claude-code/issues/56079)
- Share findings as you go; don't run long silent stretches of tool calls, and never ask about findings you haven't shown.
  1 issue · 25 reactions · [#66960](https://github.com/anthropics/claude-code/issues/66960)
- Don't state facts about code, APIs or files you haven't checked; read them first or say you're not sure.
  1 issue · 21 reactions · [#50235](https://github.com/anthropics/claude-code/issues/50235)
- Never invent tool output. If a tool call was cancelled or failed, say so and run it again.
  1 issue · 20 reactions · [#63538](https://github.com/anthropics/claude-code/issues/63538)
- For simple tasks, act directly; don't spend minutes thinking before writing the first line of code.
  1 issue · 19 reactions · [#23688](https://github.com/anthropics/claude-code/issues/23688)
- Don't run no-op commands such as `echo` to probe or flush shell output.
  1 issue · 17 reactions · [#63887](https://github.com/anthropics/claude-code/issues/63887)
- Treat every rule in CLAUDE.md as binding, including after context compaction; check your work against them before saying you're done.
  1 issue · 15 reactions · [#33603](https://github.com/anthropics/claude-code/issues/33603)
- Never change a test just to make it pass; fix the code, or say why you think the test is wrong and ask.
  1 issue · 11 reactions · [#319](https://github.com/anthropics/claude-code/issues/319)
- Don't pipe command output through `head` or `tail` before you've read its errors; read the full output when a command fails.
  1 issue · 8 reactions · [#39945](https://github.com/anthropics/claude-code/issues/39945)
