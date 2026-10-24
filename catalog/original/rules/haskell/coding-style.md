---
paths:
  - "**/*.hs"
  - "**/*.cabal"
---
# Haskell

In depth: the `haskell-patterns` skill.

## Conventions
- Language edition `GHC2021` unless the repo picks another; extra extensions go per module or in `default-extensions`, consistently. `Text` literals need `OverloadedStrings`.
- Total functions: no `head`, `tail`, `fromJust`, `!!`, `read` or `error` in library code. Use pattern matching, `NonEmpty`, `readMaybe`, and `Maybe` or `Either` results.
- `Text` for text, `ByteString` for bytes, `String` only at legacy edges. Decode untrusted input with `decodeUtf8'` or `decodeUtf8Lenient`.
- Strict accumulators and data: `foldl'`, `Data.Map.Strict`, `modifyIORef'`, `modify'`, and `StrictData` or bang fields on records.
- IO errors are specific exception types raised with `throwIO`. Never catch `SomeException` without rethrowing asynchronous exceptions; use `catchAny` from `UnliftIO.Exception` or `Control.Exception.Safe`.
- Concurrency through async (`withAsync`, `concurrently`, `race`) and STM, never a bare `forkIO`; executables build with `-threaded -rtsopts -with-rtsopts=-N`.
- Top-level type signatures everywhere, explicit export lists, qualified imports for containers and text (`import Data.Map.Strict qualified as Map`).
- `.cabal` files share a common stanza with `-Wall -Wcompat -Widentities -Wredundant-constraints -Wpartial-fields` and give dependencies version bounds. When hpack generates the `.cabal` file, edit `package.yaml` instead.

## Tools and tests
- Format with the repo's formatter: `ormolu --mode inplace` or `fourmolu -i`, checked in CI with `--mode check`. Format `.cabal` files with `cabal-fmt -i`.
- Lint with `hlint src test`; project rules live in `.hlint.yaml`.
- Build and test with `cabal build all && cabal test all --test-show-details=direct`, or `stack build && stack test`. Run one group with `cabal test --test-options='-m "Parser"'`. CI adds `--ghc-options=-Werror`.
- Tests use hspec with hspec-discover, plus QuickCheck properties for pure logic.
