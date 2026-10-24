---
paths:
  - "**/*.scala"
  - "**/*.sc"
  - "**/*.sbt"
---
# Scala

In depth: the `scala-patterns` skill.

## Conventions
- Scala 3 syntax: `import a.*`, `import a.{B as C}`, `?` type wildcards, `xs*` varargs, `A & B`. New code has no `implicit`: use `given`/`using`, `extension` and `summon`, in the given syntax the project's version supports (3.6+ `given Show[Int]:`, 3.3 LTS `given Show[Int] with`).
- `import a.*` doesn't import givens; add `import a.given` or keep instances in companion objects.
- Braces or significant indentation: follow the file and `.scalafmt.conf`. Never mix them in a file or restyle code you aren't changing.
- Model domains with `enum` or sealed hierarchies, `opaque type` for wrapped primitives and case classes for data. Matches on domain types are exhaustive with no catch-all case.
- Immutable by default: `val`, immutable collections, `Option` instead of `null`; no `return`, and `asInstanceOf` only at interop boundaries. Public members declare their result types.
- Effects run only at the edge (`IOApp`, `ZIOAppDefault`, `@main`); blocking calls use `IO.blocking`, `ZIO.attemptBlocking` or a dedicated pool; no `IO` or `Future` value is discarded.
- No `:+` accumulation on `List` in loops; Java collections convert through `scala.jdk.CollectionConverters`.

## Tools and tests
- Format with `sbt scalafmtAll` and check with `sbt scalafmtCheckAll`; `.scalafmt.conf` sets `version` and `runner.dialect = scala3`.
- Lint with `sbt "scalafixAll --check"` (OrganizeImports, RemoveUnused). Compile with `-deprecation -feature -Wunused:all -Wvalue-discard`, plus `-Werror` in CI.
- Test with `sbt test` or `sbt "testOnly *PriceSuite"`, `./mill __.test` on Mill, `scala test .` on scala-cli. Use the repo's framework: munit, or ScalaTest 3.2 style traits such as `AnyFunSuite`.
- sbt 2.x builds use slash syntax only (`Test / fork := true`) and quoted command chains in CI (`sbt "clean ; test"`).
