# plugin2valdi reference docs

Maintainer reference for the plugin2valdi codebase. Start at the
[README](../README.md) for what the tool is, or
[CONTRIBUTING](../CONTRIBUTING.md) for how to change it.

## Index

| Document | Covers |
|---|---|
| [translation.md](./translation.md) | The idiom-to-emission table, rejection mechanics, the no-webview and no-host policies, structural limits. |
| [compiler-grammar.md](./compiler-grammar.md) | Grammar rules the Valdi compiler enforces, and the one upstream fix the toolchain needs. |
| [react-native.md](./react-native.md) | The React Native TurboModule intake: detection, mapping, verified packages. |
| [local-fork.md](./local-fork.md) | Exact steps to build the patched Valdi compiler, and why each local change exists. |

Proof screenshots live in [screenshots/](./screenshots/), one file per
verified claim. The README links each one next to the claim it proves.

## Source map

```text
bin/      CLI entry points (translate, build-valdi, survey, validate)
lib/      the pipeline:
            parse-contract.mjs  AST contract extraction (TypeScript)
            translate.mjs       orchestration + output layout
            emit-dts.mjs        annotated .d.ts contract emission
            emit-bazel.mjs      BUILD.bazel + tsconfig wiring
            emit-factory.mjs    module factories
            conform-swift.mjs   Swift conformance + selector label matrix
            transform-swift.mjs Swift body translation (no-host policy)
            transform-objc.mjs  ObjC body translation
            transform-java.mjs  Java body translation + Kotlin skeletons
            rn*.mjs             React Native intake (Spec, ObjC pre-pass, Java)
            build-valdi.mjs     compile-through-toolchain driver
            survey.mjs          app-wide migration report
test/     fixture-first suite: one synthetic plugin per shape, run.mjs
example/  a complete Valdi app with converted modules (see its README)
docs/     this reference layer + proof screenshots
```

## Quick commands

Copied verbatim from package.json scripts:

```bash
npm test
npm run lint
npm run guards
```
