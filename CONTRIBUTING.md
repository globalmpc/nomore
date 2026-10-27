# Contributing

Thanks for helping! Three ways, from quickest to most involved:

1. **Propose a rule.** Open a [rule proposal](../../issues/new?template=propose-a-rule.md) with the rule in one
   sentence and links to the issues or posts behind it.
2. **Report a wrong suggestion.** If `npx @globalmpc/nomore` suggests something that isn't a rule, open a
   [wrong suggestion](../../issues/new?template=wrong-suggestion.md) issue with its category. Please never paste
   your transcripts: they can contain private code and secrets.
3. **Send code.**

   ```bash
   pnpm install
   pnpm test        # all tests must pass
   pnpm typecheck
   ```

   Tests use made-up data only (`test/fixtures/`). Every bug fix comes with a test that fails without it.
