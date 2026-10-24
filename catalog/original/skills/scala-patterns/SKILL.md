---
name: scala-patterns
description: Scala 3 patterns for 3.3 LTS through 3.9 LTS covering given/using versus Scala 2 implicits, enums and ADTs, opaque types, extension methods, the syntax options, choosing Cats Effect, ZIO or Futures, Future pitfalls, collection performance, sbt 1 and 2, Mill and scala-cli, munit and ScalaTest, Scalafmt and Scalafix. Use when editing .scala, .sc or .sbt files, migrating Scala 2 code or habits to Scala 3, choosing an effect stack, or setting up a Scala build, tests or linting.
---

# Scala 3 Patterns

Targets **Scala 3.9 LTS** (September 2026, JDK 17+), with notes for **3.3 LTS**, still the line to use when JDK 8 or 11 must be supported. 3.10 is the current Scala Next release. Check `scalaVersion` in `build.sbt`, `build.mill` or `//> using scala` before writing a feature marked with a version below.

## Scala 2 habits to stop writing

| Scala 2 habit | Scala 3 |
|---|---|
| `implicit val ord: Ordering[User] = ...` | `given Ordering[User] = ...` |
| `def run(x: A)(implicit ec: ExecutionContext)` | `def run(x: A)(using ExecutionContext)`; pass one explicitly with `run(a)(using ec)` |
| `implicitly[Ordering[A]]` | `summon[Ordering[A]]` |
| `implicit class RichString(s: String)` | `extension (s: String) def slug: String = ...` |
| `implicit def toB(a: A): B` | `given Conversion[A, B]` plus `import scala.language.implicitConversions` where it is used, or an `into[B]` parameter type (stable in 3.9) |
| `sealed trait Color` with `case object`s, or `Enumeration` | `enum Color { case Red, Green, Blue }` |
| `object Main extends App` | `@main def run(args: String*): Unit` |
| `package object util` | top-level `def`, `val` and `type` in any file |
| `import cats.syntax.all._`, `import a.{B => C}` | `import cats.syntax.all.*`, `import a.{B as C}` |
| `List[_]`, `xs: _*`, `A with B` (deprecated since 3.4) | `List[?]`, `xs*`, `A & B` |
| `private[this]`, `var x: T = _`, `f _` (deprecated since 3.4) | `private`, `var x: T = scala.compiletime.uninitialized`, `f` |
| `def run() { ... }` (procedure syntax, dropped) | `def run(): Unit = ...` |
| kind-projector `Either[E, *]`, type-lambda projections | `[A] =>> Either[E, A]` |
| `val Some(port) = config.get("port")` (refutable-pattern warning) | `val Some(port) = config.get("port").runtimeChecked` (3.8+), or a `match` |
| `scala.collection.JavaConverters._` | `import scala.jdk.CollectionConverters.*` |

`-rewrite -source 3.4-migration` applies the 3.4 rewrites automatically. A Scala 3 method declared with `()` must be called with `()`; the compiler no longer inserts it.

## Givens and context parameters

- Givens carry type class instances and context (an `ExecutionContext`, a transaction, a config), not ordinary dependencies.
- `import lib.*` does **not** import givens. Write `import lib.given`, `import lib.{given, *}`, or by type `import lib.{given Codec[?]}`. Instances placed in the companion object of the type or the type class need no import.
- The given syntax depends on the version. 3.3 LTS knows only the original form; 3.6 introduced a new form and still accepts the old one.

```scala
trait Show[A]:
  extension (a: A) def show: String

// Scala 3.6+ (3.9 LTS)
given Show[Int]:
  extension (n: Int) def show = n.toString
given [A: Show] => Show[List[A]]:
  extension (xs: List[A]) def show = xs.map(_.show).mkString("[", ", ", "]")

// Scala 3.3 LTS form, still accepted by later versions
given Show[Int] with
  extension (n: Int) def show = n.toString
given [A](using Show[A]): Show[List[A]] with
  extension (xs: List[A]) def show = xs.map(_.show).mkString("[", ", ", "]")
```

- Context bounds from 3.6: several at once (`[A: {Ordering, Show}]`) and named (`[A: Ordering as ord]`). On 3.3 write `[A: Ordering: Show]` or an explicit `using` clause.
- Derive instances with `derives` where the library supports Scala 3 derivation instead of hand-writing `given`s or `implicit val` codecs; `derives CanEqual` plus `-language:strictEquality` makes `==` between unrelated types a compile error.

## Enums, ADTs, opaque types, extensions

```scala
enum Payment:
  case Card(last4: String)
  case Invoice(dueDays: Int)
  case Cash

def describe(p: Payment): String = p match
  case Payment.Card(last4)  => s"card ending in $last4"
  case Payment.Invoice(due) => s"invoice due in $due days"
  case Payment.Cash         => "cash"

opaque type UserId = Long
object UserId:
  def parse(raw: String): Either[String, UserId] =
    raw.toLongOption.filter(_ > 0).toRight(s"invalid user id: $raw")
  extension (id: UserId) def value: Long = id
```

- `enum` covers closed sets and ADTs. Keep `sealed trait` plus `case class` when cases need different parents, separate files, or Java interop.
- A case constructor is typed as the enum: `Payment.Card("4242")` is a `Payment` unless a `Payment.Card` is expected, so ascribe the type when you need the case's fields or `copy`.
- Matches on enums and sealed types are checked for exhaustivity. Don't add `case _ =>` on domain types, so a new case breaks the build instead of falling through.
- An opaque type is distinct from its underlying type only at compile time: outside its scope `UserId` and `Long` don't mix, at runtime it is a plain `Long`. Validate in the companion's constructors and expose operations as extensions.
- Named tuples (3.7+), such as `(name = "Ada", age = 36)`, suit ad hoc results; domain data stays in case classes.

## Syntax options

Scala 3 accepts braces and indentation-based syntax (`:` after `class`, `object` and `trait`; `if ... then`, `while ... do`; optional `end` markers; from 3.3 a `:` can also start a lambda argument block). Follow what the file and `.scalafmt.conf` already use, never mix the two in one file, and don't restyle code you aren't changing. The compiler converts in two passes: `-rewrite -new-syntax`, then `-rewrite -indent` (reverse with `-rewrite -no-indent`, then `-rewrite -old-syntax`). From 3.4, a refutable pattern in a `for` generator needs `case`: `for case (k, Some(v)) <- pairs yield k -> v`.

## Choosing an effect stack

| Situation | Choice |
|---|---|
| The codebase already uses one | stay with it; Cats Effect and ZIO in one codebase means interop layers and two sets of concepts |
| http4s, fs2, doobie, skunk, the Typelevel ecosystem | Cats Effect 3 (`IO`, `Resource`, `Ref`, `Deferred`, `IOApp`) |
| typed error channel and built-in dependency injection | ZIO 2 (`ZIO[R, E, A]`, `ZLayer`, `ZIOAppDefault`) |
| Play, Pekko, small services, existing `Future` APIs | `Future`, following the rules in the next section |
| JDK 21+ and a team that prefers direct style | Ox or virtual threads instead of a monadic effect |

- Run effects only at the edge: `IOApp`, `ZIOAppDefault` or a framework integration. `unsafeRunSync()` inside business code bypasses cancellation and resource safety.
- Blocking calls (JDBC, file I/O, legacy SDKs) go through `IO.blocking` or `ZIO.attemptBlocking`, never straight onto the compute pool.
- Wrap a `Future` lazily, `IO.fromFuture(IO(client.call()))`, so it can be retried and isn't started early.
- An effect that is built but never composed into the program doesn't run. `-Wnonunit-statement` (3.3.1+) and `-Wvalue-discard` catch discarded `IO` and `Future` values.
- Akka moved to the Business Source License in 2022; Apache Pekko is the Apache-licensed fork.

## Future pitfalls

```scala
// sequential: fetchB() is called only after fetchA() completes
val slow = fetchA().flatMap(a => fetchB().map(b => (a, b)))
// parallel: both futures are running before they are combined
val fast = fetchA().zip(fetchB())
```

- A `Future` starts the moment it is created, which is also why it can't be retried: retry helpers take `() => Future[A]`.
- `ExecutionContext.global` has roughly one thread per core. Wrap unavoidable blocking in `scala.concurrent.blocking { ... }` or give it a dedicated pool.
- `Await.result` outside `main` and tests can deadlock a pool; compose futures instead.
- `Future.traverse` and `Future.sequence` start every element at once. Batch large inputs or use a stream with bounded parallelism.
- A dropped future swallows its failure. Return it, or attach an `onComplete` that logs.

## Collections and performance

- `List` is a linked list: `head` and prepend are O(1), while `:+`, `apply(i)`, `length` and `last` are O(n). Use `Vector` or `ArraySeq` for indexed access and appends, and accumulate with a `ListBuffer` or a builder, never `acc :+ x` in a loop.
- For long `map`/`filter`/`flatMap` chains over large data, go through `.iterator` once and materialize at the end (`.to(Vector)`). A `view` re-runs its whole pipeline on every traversal.
- Membership tests inside loops use a `Set` or `Map`, not `List.contains`.
- `mapValues` and `filterKeys` (deprecated since 2.13) return lazy views that recompute on access; use `.view.mapValues(f).toMap` or `.map`.
- `groupBy` followed by a size or sum becomes `groupMapReduce`; size checks on lists use `isEmpty` or `xs.sizeIs > 3`.
- Generic collections box primitives. Hot numeric code uses `Array[Int]` or `IArray[Int]`.

## Builds: sbt, Mill, scala-cli

- **sbt**: `project/build.properties` pins the version. sbt 2.0 (June 2026) writes `build.sbt` in Scala 3, applies bare settings to every subproject, caches tasks by default, writes output under `target/out/`, and drops sbt 0.13 syntax: use `Compile / scalacOptions` and `Test / fork := true`, never `in Compile` or `test:compile`, and quote command chains in CI (`sbt "clean ; test"`). sbt 1.12 remains the current 1.x line; check that every plugin supports the sbt major in use.
- **Mill 1.x**: `build.mill` starts with `package build` and `import mill.*, scalalib.*`; dependencies are `def mvnDeps = Seq(mvn"org::name:version")`. Older builds used `build.sc` and `ivyDeps`/`ivy"..."`. Commands: `./mill app.compile`, `./mill app.test`, `./mill __.test`.
- **scala-cli** has been the `scala` command since 3.5. Directives go at the top of a file or in `project.scala`: `//> using scala 3.9.0`, `//> using dep com.lihaoyi::os-lib:<version>`, `//> using test.dep org.scalameta::munit:<version>`, `//> using jvm 21`. Run with `scala run .` and `scala test .`; it suits scripts, examples and small tools.
- `%%` appends the Scala binary suffix (`_3`). A Scala 2.13 library works from Scala 3 via `.cross(CrossVersion.for3Use2_13)` unless it relies on Scala 2 macros.

## Testing

- **munit** 1.x is the light default: `class PriceSuite extends munit.FunSuite`, `assertEquals(obtained, expected)`; comparing unrelated types is a compile error. `munit.CatsEffectSuite` (munit-cats-effect) lets a test return an `IO` (`assertIO`, `.assertEquals`); munit-scalacheck adds `property`.
- **ScalaTest 3.2** keeps its styles in packages: `org.scalatest.funsuite.AnyFunSuite`, `org.scalatest.flatspec.AnyFlatSpec`, `org.scalatest.matchers.should.Matchers`. The pre-3.1 names (`org.scalatest.FunSuite`, `org.scalatest.Matchers`) no longer exist.
- ZIO code uses zio-test (`ZIOSpecDefault`); weaver-test is common with Cats Effect. Return the effect from the test rather than calling `unsafeRunSync()` or `Await`.

```scala
class PriceSuite extends munit.FunSuite:
  test("a discount applies once") {
    assertEquals(Price(100).discounted(10).discounted(10), Price(90))
  }
```

```bash
sbt test                                   # or: sbt "testOnly *PriceSuite"
sbt ~testQuick                             # rerun affected tests on change
sbt "scalafmtCheckAll ; scalafixAll --check"
./mill __.test
scala test .
```

## Scalafmt, Scalafix and compiler flags

- `.scalafmt.conf` must set `version` and `runner.dialect = scala3`. Style rewrites (new control syntax, optional braces) live under `rewrite.scala3.*`; change them in their own commit, not alongside a feature.
- Scalafix (sbt-scalafix 0.14+, supports 3.9 LTS) needs `semanticdbEnabled := true` (no `semanticdbVersion` on Scala 3). `RemoveUnused` and `OrganizeImports` (built in since Scalafix 0.11) need `-Wunused:all` (3.3.4+) or at least `-Wunused:imports`. CI runs `scalafixAll --check`.
- Compiler flags worth having: `-deprecation`, `-feature`, `-Wunused:all`, `-Wvalue-discard`, `-Wnonunit-statement`, and `-Werror` in CI. `-Wall` works on 3.5.2+ and 3.3.5+; `-explain` prints long explanations while fixing an error.

## Review checklist

- [ ] No Scala 2 syntax deprecated in 3.4 (`_` type wildcards, `: _*`, `with` in types, `private[this]`); imports use `*` and `as`.
- [ ] No `implicit` in new code; givens live in companions or are imported with `.given`, in the syntax the project's Scala version supports.
- [ ] ADTs are enums or sealed hierarchies with exhaustive matches and no catch-all on domain types.
- [ ] Effects run only at the edge, blocking work runs on a blocking pool, and no `IO` or `Future` is discarded.
- [ ] No `:+` accumulation on `List` and no repeated `view` traversals on hot paths.
- [ ] Build edits match the build tool's major version (sbt 1 or 2, Mill 1).
- [ ] `scalafmtCheckAll`, `scalafixAll --check` and the tests pass with no new warnings.

<!-- Written for legacies (MIT). Checked against: https://scala-lang.org/news/3.8/, https://github.com/scala/scala3/releases/tag/3.9.0, https://scala-lang.org/blog/2024/02/29/scala-3.4.0-and-3.3.3-released.html, https://scala-lang.org/blog/2024/08/22/scala-3.5.0-released.html, https://scala-lang.org/news/3.7.0, https://docs.scala-lang.org/scala3/reference/contextual/givens.html, https://docs.scala-lang.org/scala3/reference/contextual/previous-givens.html, https://docs.scala-lang.org/scala3/reference/contextual/context-bounds.html, https://docs.scala-lang.org/scala3/reference/contextual/given-imports.html, https://docs.scala-lang.org/scala3/reference/other-new-features/into.html, https://docs.scala-lang.org/scala3/reference/other-new-features/indentation.html, https://docs.scala-lang.org/scala3/guides/migration/compiler-options.html, https://www.scala-sbt.org/2.x/docs/en/changes/migrating-from-sbt-1.x.html, https://mill-build.org/mill/scalalib/intro.html, https://scala-cli.virtuslab.org/docs/reference/directives, https://scalameta.org/munit/docs/assertions.html, https://github.com/typelevel/munit-cats-effect, https://scalameta.org/scalafmt/docs/configuration.html, https://scalacenter.github.io/scalafix/docs/users/installation.html, https://scalacenter.github.io/scalafix/docs/rules/RemoveUnused.html, https://github.com/softwaremill/ox, 2026-10 -->
