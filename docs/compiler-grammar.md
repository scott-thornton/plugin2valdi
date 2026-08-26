# Compiler grammar reference

The grammar rules the Valdi compiler enforces, learned from build
failures. Each rule below cost a real failed build. The fixtures and the
flags in lib/ carry the evidence.

## Rules

- No `@word` inside comment prose. The annotation parser treats it as an
  annotation.
- Annotation closure is enforced. Every type the contract references must
  carry an annotation.
- One Android package per module.
- String literal unions are rejected in every position. The tool collapses
  them to `string` and preserves the literal set in the flags. Use
  `@ExportEnum` when the enum matters.
- Swift imports ObjC selectors under special names. The tool maps the full
  rule set. See the table and the evidence in lib/conform-swift.mjs.
- ObjC reserves some words. The tool renames them, for example `id`
  becomes `id2`.
- A module without a `tsconfig.json` in `srcs` compiles its TypeScript to
  declarations only. No JS reaches the `.valdimodule`, and the app fails
  at runtime with `No item named '<module>/src/*.js' in module '...'`.
  The tool emits the file and the glob addendum for you.

## Upstream dependency

Generated type headers imported themselves. This broke clang module
builds, which is the path Swift interop uses.

The fix (a static `filterSelfImports` helper in
CombineNativeSourcesProcessor) is MERGED upstream: Snapchat/Valdi commit
8d81afd1, 2026-08-24. No tagged release carries it yet - the latest tag
is still beta-0.1.1. Until a release ships it, apply `upstream-pr.diff`
to the beta tarball checkout (iOS only; Android builds run unpatched,
CI-verified):

```bash
cd <valdi-checkout>
git apply <repo>/upstream-pr.diff
```

The exact local build steps, including the compiler rebuild, are in
[local-fork.md](./local-fork.md) - what to change in a Valdi checkout and
why each change exists.

CI evidence (example-android workflow): Android codegen does NOT need
the patch. The full example app builds and packages on the stock
prebuilt compiler. The self-referential-import bug only breaks the
merged type headers that Swift conformance targets compile against.

Four more compiler findings are drafted as upstream issues, not yet
filed.
