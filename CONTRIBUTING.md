# Contributing to plugin2valdi

TL;DR: flag, don't guess. Add every new plugin shape as a failing fixture
first. Keep docs in Simplified Technical English. Run `npm test` before
you finish.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run the fixture suite (enforced: this must pass before any change lands). |
| `npm run lint` | ESLint over lib/, bin/ and scripts/ (enforced: recommended rules, no fixer-only commits). |
| `npm run guards` | Enforced conventions: no em dashes in docs or flag text; npm tarball ships runtime surface only. |
| `node bin/plugin2valdi.mjs test/fixtures/basic --out out` | Translate one fixture by hand and inspect the output. |
| `node bin/plugin2valdi-validate.mjs test/fixtures/basic out/test_basic` | Check ritual coverage and body preservation for one output. |

## Architecture summary

The pipeline, one pass, no hidden phases:

```text
plugin dir
  -> parse-contract.mjs   AST contract extraction (TypeScript, @babel/parser)
  -> emit-dts.mjs         annotated .d.ts (the Valdi compiler consumes this)
  -> transform-*.mjs      native bodies: swift / objc / java (+ rn*.mjs intake)
  -> emit-bazel.mjs       BUILD.bazel + tsconfig
  -> emit-factory.mjs     module factories
  -> out/<module>/ + FLAGS.md
```

`translate.mjs` orchestrates. `build-valdi.mjs` wraps the loop with a
compile through the real toolchain. The full source map is in
[docs/README.md](docs/README.md).

## The one rule

**Flag, don't guess.** When the translator encounters a shape it can't
handle mechanically, it must degrade to partial output plus a blocking
flag in `FLAGS.md` - never silently mistranslate, never crash without a
manifest. A missed translation is review work; a wrong translation is a
production bug.

## Core conventions

1. **Fixture first.** Every new plugin shape lands as a synthetic fixture
   under `test/fixtures/<name>/` before the parser or a transformer
   changes. Enforcement: `npm test` fails until the shape translates
   correctly.
2. **Verified grammar only.** The emitted `.d.ts` grammar is verified
   against a real Valdi toolchain. Never emit grammar shapes that have
   not compiled through the real compiler. If Valdi's annotation parser
   changes, update `lib/emit-dts.mjs`, the findings in
   [docs/compiler-grammar.md](docs/compiler-grammar.md) and the fixtures
   together.
3. **Write docs in Simplified Technical English.** Short sentences. No
   idioms or metaphors. No em dashes; use a hyphen. Enforcement (the em
   dash half): `npm run guards` scans tracked docs and lib flag text.
4. **Claims must be regenerable.** A doc may only cite plugins a reader
   can fetch (public npm packages) or files in this repo. Every count has
   one home; do not copy counts between docs.

## How to add support for a new plugin shape

1. Write a synthetic fixture under `test/fixtures/<name>/` that
   reproduces the shape (definitions.ts + minimal ios/android sources).
   Do not vendor real plugins. Licenses vary. Use a synthetic fixture.
2. Run `npm test` - the new fixture should fail in the way you found.
3. Fix the parser (contract side: @babel/parser AST in
   lib/parse-contract.mjs; native side: ritual rewriting in
   transform-*.mjs); the fixture becomes the regression test.
4. Update the table in [docs/translation.md](docs/translation.md) if the
   mapping changed, and [docs/compiler-grammar.md](docs/compiler-grammar.md)
   if you learned a new compiler rule.
5. Add the doc index row if you created a doc.

## Pre-finish checklist

- `npm test` passes.
- `npm run lint` passes.
- `npm run guards` passes.
- New grammar shapes compiled through the real toolchain at least once.
- FLAGS.md wording for any new flag states what to do by hand.
- Docs updated in the same change (table rows, grammar rules, counts).
- No em dashes, no idioms, in any doc you touched (`npm run guards`
  catches the dashes).

## Reporting a plugin that fails

Open an issue with the plugin's `definitions.ts` (or the compiled
`definitions.d.ts`) and the `FLAGS.md` plugin2valdi produced. Don't paste
proprietary native sources - the contract file is almost always enough to
reproduce parser issues.
