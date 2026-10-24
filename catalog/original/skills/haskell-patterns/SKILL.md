---
name: haskell-patterns
description: Production Haskell on GHC 9.10-9.14 with GHC2021 covering cabal and stack setup, warning flags, strictness and space leaks (foldl', StrictData, bang patterns), Text versus ByteString versus String, records and lens choices, Either, ExceptT and IO exceptions, async and STM, ReaderT and mtl architecture, hspec and QuickCheck, HLint and Ormolu/Fourmolu. Use when editing .hs or .cabal files, stack.yaml or package.yaml, chasing a space leak, or setting up Haskell builds, tests and linting.
---

# Haskell Patterns

Targets **GHC 9.10–9.14** with the **GHC2021** language edition, GHC's default since 9.2. GHC 9.14.1 (December 2025) is the newest series; Stackage LTS 24 uses GHC 9.10 and Nightly uses 9.12. Check `tested-with`, `stack.yaml` or `ghc --version` before relying on anything marked with a version below.

## Version notes

- GHC2021 already enables `BangPatterns`, `ImportQualifiedPost`, `TypeApplications`, `ScopedTypeVariables`, `NamedFieldPuns`, `GeneralisedNewtypeDeriving`, `DeriveGeneric`, `NumericUnderscores` and more. It does **not** enable `OverloadedStrings`, `LambdaCase`, `DerivingStrategies`, `DerivingVia`, `DeriveAnyClass`, `RecordWildCards`, `OverloadedRecordDot` or `StrictData`; turn those on per module or in `default-extensions`.
- `GHC2024` (GHC 9.10+) adds `DataKinds`, `DerivingStrategies`, `DisambiguateRecordFields`, `ExplicitNamespaces`, `GADTs`, `LambdaCase`, `MonoLocalBinds` and `RoleAnnotations`. Switch editions deliberately: `MonoLocalBinds` can break type inference of local bindings.
- base 4.20 (GHC 9.10) exports `foldl'` from `Prelude`; older compilers need `import Data.List (foldl')`.
- GHC 9.8+ warns on `head` and `tail` (`-Wx-partial`). Pattern match, or use `Data.List.NonEmpty` or `uncons`, instead of silencing it.
- `-Wall` covers `-Wincomplete-uni-patterns` and `-Wincomplete-record-updates`; GHC 9.14 adds `-Wincomplete-record-selectors`, which can break `-Werror` builds after an upgrade.

## Project setup

- Install toolchains with GHCup (`ghcup tui`). HLS must be built for the exact GHC version in use.
- **cabal**: one `.cabal` file per package plus a `cabal.project` (`packages: .`, and a pinned `index-state:` or a committed `cabal.project.freeze` for reproducible builds). Commands: `cabal build all`, `cabal test all`, `cabal run exe:shop -- args`, `cabal repl lib:shop`. Format `.cabal` files with `cabal-fmt`.
- **stack**: `stack.yaml` picks a Stackage snapshot (`snapshot: lts-24.<n>`; `resolver:` is a deprecated synonym) plus `extra-deps`. When `package.yaml` exists, hpack generates the `.cabal` file: edit `package.yaml`, never the generated file.
- Executables need `-threaded -rtsopts -with-rtsopts=-N`, otherwise the program runs on one core and RTS options such as heap profiling are refused.
- `-Werror` only in CI (`cabal build all --ghc-options=-Werror`), so a new compiler's warnings don't break local builds.

```cabal
cabal-version: 3.4
name:          shop
version:       0.1.0.0

common shared
  default-language:   GHC2021
  default-extensions: OverloadedStrings
  ghc-options:        -Wall -Wcompat -Widentities -Wredundant-constraints
                      -Wpartial-fields -Wunused-packages
  build-depends:      base >=4.18 && <5

library
  import:          shared
  hs-source-dirs:  src
  exposed-modules: Shop.Order
  build-depends:   containers, text ^>=2.1

test-suite spec
  import:             shared
  type:               exitcode-stdio-1.0
  hs-source-dirs:     test
  main-is:            Spec.hs
  build-depends:      shop, hspec, QuickCheck
  build-tool-depends: hspec-discover:hspec-discover
```

## Strictness and space leaks

Leaks come from thunks piling up in accumulators, maps and long-lived state.

- Fold with `foldl'`, never `foldl`. `foldl'` forces only the outer constructor, so a lazy tuple or record accumulator still leaks: make its fields strict.
- `StrictData` per module, or `!` on fields, for plain data records. Leave a field lazy only on purpose (an expensive value that may never be used).
- Use `Data.Map.Strict` and `Data.IntMap.Strict` (plain `Data.Map` is the lazy API), `modifyIORef'`, `atomicModifyIORef'` and `modifyTVar'`. `Control.Monad.State.Strict` is strict in the state/result pair, not in the state value, so update it with `modify'`.
- Bang patterns on loop arguments: `go !acc (x : xs) = go (acc + x) xs`.
- The whole-module `Strict` extension changes the meaning of `let`, `where` and function arguments; avoid it unless the module was written for it.
- `force` and `NFData` from deepseq when a value must be fully evaluated, for example before it is handed to another thread or stored in a cache: `evaluate (force x)`.
- Lazy I/O (`readFile` from `Prelude`, `getContents`) keeps handles open and defers errors. Read strictly (`Data.ByteString.readFile`, `Data.Text.IO.Utf8.readFile`) or stream with conduit, streaming or streamly.
- Measure before guessing: `+RTS -s` for GC statistics, `+RTS -hT` for a heap profile by closure type without a profiling build, `-prof` builds with `+RTS -hc` or `-hy` for cost centres and types; view the result with eventlog2html.

```haskell
{-# LANGUAGE StrictData #-}
import Data.Map.Strict qualified as Map
import Data.Text (Text)

data Stats = Stats {count :: Int, total :: Double}  -- fields are strict under StrictData

summarize :: [Double] -> Stats
summarize = foldl' (\(Stats c t) x -> Stats (c + 1) (t + x)) (Stats 0 0)

frequencies :: [Text] -> Map.Map Text Int
frequencies = foldl' (\m w -> Map.insertWith (+) w 1 m) Map.empty
```

## Text, ByteString and String

| Type | Use for |
|---|---|
| `Text` (strict) | human-readable text; stored as UTF-8 since text 2.0 |
| `ByteString` (strict) | bytes: sockets, files, hashes, encoded JSON |
| lazy `Text`/`ByteString`, builders | large or streamed output; build in loops with `Data.Text.Lazy.Builder` or `Data.ByteString.Builder` |
| `String` | small values and legacy APIs (`FilePath`, `show`, `error`) only |

- Decode at the boundary with `decodeUtf8'` (returns `Either`) or `decodeUtf8Lenient` (replaces invalid bytes). `decodeUtf8` throws on invalid input; never use it on untrusted data. Encode with `encodeUtf8`.
- `Data.ByteString.Char8.pack` truncates each character to 8 bits; it is not a text encoder.
- `Data.Text.IO` uses the locale's encoding. `Data.Text.IO.Utf8` (text 2.1+) always uses UTF-8.
- `show` is for debugging (it adds quotes and escapes). Format user-facing text with `Text` functions or a formatting library. `read` is partial: use `Text.Read.readMaybe` or `Data.Text.Read.decimal`.
- `Text` and `ByteString` literals need `OverloadedStrings`.

## Records and lenses

- Read fields with `OverloadedRecordDot` (`order.customer.email`). `DuplicateRecordFields` lets types share field names, and `NoFieldSelectors` stops fields from also becoming top-level functions.
- Since GHC 9.4 a field selector must be unambiguous, and a record update must use fields that only one type has all of. Updating a shared name (`order {name = n}` when two types have `name`) is an error: rename the field, rebuild with the constructor, or use optics.
- Record update syntax covers shallow changes. Use optics only for deep updates, traversals and prisms over sum types: `optics` (clear errors, labels through `OverloadedLabels`), `lens` (largest ecosystem, `makeLenses`), `microlens` (few dependencies) or `generic-lens`. Use whichever the codebase already has.
- Prefer `NamedFieldPuns` (in GHC2021) to `RecordWildCards`, which hides where names come from.

## Errors

- Pure code returns `Maybe` when absence needs no explanation and `Either DomainError a` otherwise. `error`, `undefined`, `fromJust`, `head` and `!!` are bugs waiting for an input.
- `ExceptT e m` sequences fallible steps within one function or module. Don't make it the application's base monad: IO still throws exceptions, so you get two error channels, and unliftio deliberately has no `MonadUnliftIO` instance for `ExceptT`, so `bracket` and `withAsync` from unliftio don't work in it.
- In `IO`, define exception types and raise them with `throwIO`. `throw` in pure code fires whenever the value happens to be forced. Clean up with `bracket` or `finally`.
- Catching `SomeException` also catches asynchronous exceptions (`killThread`, `timeout`, `cancel`) and breaks cancellation. Catch specific types, or use `catchAny`/`tryAny` from `UnliftIO.Exception` or `Control.Exception.Safe`, which rethrow asynchronous exceptions.

```haskell
data PaymentError = CardDeclined Text | GatewayTimeout
  deriving (Show)

instance Exception PaymentError

charge :: Gateway -> Order -> IO Receipt
charge gateway order = do
  reply <- callGateway gateway order
  case reply of
    Approved receipt -> pure receipt
    Declined reason -> throwIO (CardDeclined reason)
```

## Concurrency

- Use the async package, not bare `forkIO`: `concurrently`, `race`, `mapConcurrently_` and `withAsync` cancel the other side and rethrow failures, while an exception in a forked thread nobody waits for is lost.
- `mapConcurrently` starts one thread per element and can flood a database or API. Bound it with `pooledMapConcurrentlyN` from unliftio, or a semaphore.
- Deadlines come from `System.Timeout.timeout` (microseconds).
- Shared state: an `IORef` with `atomicModifyIORef'` for a single value; `TVar`s and STM when several values change together or a thread must wait (`retry`, `check`); `TBQueue` for bounded producer/consumer queues. `MVar` code deadlocks easily.
- STM transactions rerun on conflict: keep them short, do no IO in them, and move expensive pure work outside.

```haskell
transfer :: TVar Int -> TVar Int -> Int -> STM ()
transfer from to amount = do
  balance <- readTVar from
  check (balance >= amount)  -- retries until enough funds arrive
  modifyTVar' from (subtract amount)
  modifyTVar' to (+ amount)

loadPage :: UserId -> IO (Maybe (User, [Order]))
loadPage uid = timeout 2_000_000 (concurrently (fetchUser uid) (fetchOrders uid))
```

## Application architecture

Decide once per codebase and follow the existing choice.

| Approach | Choose when |
|---|---|
| ReaderT over IO (`newtype App a = App (ReaderT Env IO a)`), mutable state in `IORef`/`TVar` fields of `Env`, errors as exceptions | default for services; simple to debug and works with unliftio |
| Handle pattern: records of functions passed explicitly | small apps and libraries; trivial test doubles |
| mtl-style classes (`MonadReader Env m`, your own `MonadPayments m`) | code must run in several monads or be tested with pure instances; costs boilerplate and needs specialization for speed |
| Effect library (`effectful`, `bluefin`; older: `polysemy`, `fused-effects`) | the project already uses one; don't introduce one on your own |

```haskell
data Env = Env {config :: Config, requestCount :: TVar Int}

newtype App a = App (ReaderT Env IO a)
  deriving (Functor, Applicative, Monad, MonadIO, MonadReader Env)

runApp :: Env -> App a -> IO a
runApp env (App action) = runReaderT action env
```

## Testing and tools

- hspec with hspec-discover: `test/Spec.hs` contains only `{-# OPTIONS_GHC -F -pgmF hspec-discover #-}`, and every `test/**/*Spec.hs` module exports `spec :: Spec`.
- QuickCheck properties for pure logic through `prop` from `Test.Hspec.QuickCheck`. Give domain types `Arbitrary` instances with `shrink`, or generate only valid values through a newtype. Hedgehog (integrated shrinking) and tasty (an alternative runner) are common alternatives.
- Keep IO at the edges so most tests are pure; test IO code against a test `Env` or handle.

```haskell
module Shop.OrderSpec (spec) where

import Shop.Order
import Test.Hspec
import Test.Hspec.QuickCheck (prop)

spec :: Spec
spec = describe "orderTotal" $ do
  it "is zero for an empty order" $
    orderTotal [] `shouldBe` 0
  prop "is never negative" $ \(items :: [LineItem]) ->
    orderTotal items >= 0
```

```bash
cabal build all && cabal test all --test-show-details=direct
cabal test --test-options='-m "orderTotal"'      # one group of specs
stack test --ta '-m orderTotal'
hlint src test                                    # configure in .hlint.yaml
ormolu --mode check $(git ls-files '*.hs')        # or: fourmolu --mode check src test
```

Ormolu has one fixed style; Fourmolu is its configurable fork (`fourmolu.yaml`). Run whichever the repo uses, never both.

## Review checklist

- [ ] No partial functions (`head`, `fromJust`, `!!`, `read`, `error`) in library code; failures are typed.
- [ ] Accumulators and long-lived data are strict: `foldl'`, strict maps, primed modify functions, strict fields.
- [ ] Text is `Text`, bytes are `ByteString`, and decoding of untrusted input can't throw.
- [ ] No `catch` on `SomeException` that swallows asynchronous exceptions; IO errors are thrown with `throwIO`.
- [ ] Threads come from async or unliftio with bounded fan-out; executables use the threaded RTS.
- [ ] Architecture follows the codebase's existing choice (ReaderT, handles, mtl or effect library).
- [ ] Builds without warnings under the project's flags; HLint, the formatter and the tests pass.

<!-- Written for legacies (MIT). Checked against: https://www.haskell.org/ghc/, https://discourse.haskell.org/t/ghc-9-14-1-is-now-available/13430, https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/control.html, https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html, https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/duplicate_record_fields.html, https://discourse.haskell.org/t/prelude-foldl-migration-guide/6950, https://gitlab.haskell.org/ghc/ghc/-/issues/24322, https://cabal.readthedocs.io/en/stable/cabal-package-description-file.html, https://docs.haskellstack.org/en/stable/configure/yaml/project/, https://www.stackage.org/, https://hackage.haskell.org/package/text/changelog, https://hackage-content.haskell.org/package/text-2.1.4/docs/Data-Text-Encoding.html, https://hspec.github.io/hspec-discover.html, https://hspec.github.io/match.html, https://github.com/tweag/ormolu, https://github.com/fourmolu/fourmolu, 2026-10 -->
