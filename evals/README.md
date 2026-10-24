# Evals

The eval is your specification for AI behaviour. If a change doesn't move the score, it isn't an improvement.

## Files

- `labels.jsonl`: one labelled case per line, `{"id": "...", "label": "..."}`, plus any fields you like
  (`input`, `note`). Labels come from a person, never from the model being scored.
- Predictions: whatever your product outputs, written as the same shape, `{"id": "...", "label": "..."}`.

See `labels.example.jsonl`. A missing prediction counts as wrong, so skipped items can't hide.

## Commands

```bash
python3 evals/score.py evals/labels.jsonl out/run1.jsonl                  # accuracy, precision/recall per label
python3 evals/score.py evals/labels.jsonl out/run1.jsonl --min 0.8        # exit 1 below 0.8 (CI / hook)
python3 evals/score.py evals/labels.jsonl out/run1.jsonl --compare out/run2.jsonl   # + flip rate between two runs
python3 evals/score.py --selftest
```

## Good cases

- Taken from real inputs, not invented ones. 20–50 to start, and add one for every new failure.
- Include the hard ones, the "should be not found" ones, and the ones people disagree on (settle those with the owner).
- Never tune a prompt by reading the eval answers and then score on the same cases only: keep ~20% aside.

## Measuring the nomore local tool on your own sessions

```bash
pnpm install
CLAUDE_CONFIG_DIR=~/.claude pnpm tsx scripts/label-groups.ts evals/group-labels-<your-name>.jsonl
```

For each repeated group it shows, answer: would you want it as a permanent rule in `CLAUDE.md`? (y/n). Your messages
appear only in your terminal; the file it writes holds group ids and labels, no text, and it prints the precision.
Share the precision line and the file.

After an update, re-score the same labels without labelling again (prints numbers only):

```bash
git pull && pnpm tsx scripts/score-labels.ts evals/group-labels-<your-name>.jsonl
```
