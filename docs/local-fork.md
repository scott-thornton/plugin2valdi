# Local fork notes - valdi-fork vs upstream

`valdi-fork/` is the beta-0.1.1 release tarball plus the upstream PR fix
(`upstream-pr.diff`) **plus** the local-only changes listed here. None of these
belong in the upstream PR; they exist to make the patched compiler actually
build and run on this host. Diff baseline: `valdi-pristine-copy/` (untouched
tarball).

## Landed upstream (8d81afd1, 2026-08-24)

The PR closed as merged-via-commit; the local fork can drop its copy of
the fix on the next rebuild against a tagged release.

## In the PR (not covered here)

- `compiler/compiler/Compiler/Sources/Processors/CombineNativeSourcesProcessor.swift`
  - the fix: filter self-referential `#import` lines in `mergeAnySources`
  (extracted into the static `filterSelfImports` helper).
- `compiler/compiler/Compiler/Tests/CompilerTests/CombineNativeSourcesProcessorTests.swift`
  - new unit tests for the filtering (4 tests, all pass; full suite 20/20).

## Local-only, intentionally NOT in the PR

| File(s) | Change | Why it exists locally |
|---|---|---|
| `compiler/compiler/Compiler/Package.swift` | Removed the `sentry-cocoa` dependency and its `Sentry` product link | Lets `swift build`/`swift test` run fully offline against the local SPM cache; the source's `import Sentry` is already guarded by `#if os(macOS) && !DEBUG`, so DEBUG builds compile without it. Upstream ships Sentry; no reason to touch it there. |
| `compiler/compiler/Compiler/Package.resolved` | Dropped the `sentry-cocoa` pin | Side effect of the Package.swift change above; regenerates automatically. |
| `bzl/valdi/BUILD.bazel` | `use_local_compiler` on macOS now routes to `:local_valdi_compiler_native` (SPM-built binary) instead of `:local_valdi_compiler` (bazel `swift_binary`) | The `swift_binary` route builds in the exec configuration, whose Apple CC toolchain pins the deployment target to the local SDK (macOS 26.2 under Xcode 26.2), producing a compiler binary that crashes on older macOS hosts (see companion issue (c)). The SPM binary targets `.macOS(.v11)`. |
| `.bazelrc` | Added `build --macos_minimum_os=13.0` | Same exec-config deployment-target problem, mitigated for the targets where the flag does apply; keeps bazel-built host binaries runnable on this machine and older hosts. |
| `compiler/compiler/out/macos/valdi_compiler` | Built compiler binary (SPM, contains the PR fix) | The patched compiler used for the E2E verification; consumed by `bzl/valdi/BUILD.bazel` routing above. Never ship a binary in a PR. |
| `MODULE.bazel.lock` | Regenerated (entries added/removed vs tarball) | Written automatically by local `bazel` runs; not an intentional change. Refresh on any clean checkout. |
| `bazel-bin`, `bazel-out`, `bazel-testlogs`, `bazel-valdi-fork` (symlinks) | Bazel convenience symlinks | Created by local bazel builds; pure build artifacts. |
| `.build/` under `compiler/compiler/Compiler/` (when present) | SPM build directory | Created by `swift build`/`swift test`; pure build artifact. |
