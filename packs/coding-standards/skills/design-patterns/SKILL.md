---
name: design-patterns
description: Choosing, applying and removing design patterns in idiomatic TypeScript, Python, Java, C# and Go. Covers when a classic or modern pattern pays for itself, when a function, sum type or generic replaces it, pattern smells and over-engineering, and refactoring toward or away from a pattern. Use when someone asks which pattern fits, proposes a factory, strategy, visitor, singleton or builder, reviews an abstraction that feels heavy, or says "over-engineered", "too many layers" or "should this be a pattern".
---

# Design Patterns

A pattern is a named way of balancing competing forces: what varies, what must stay stable, and who extends the code. Most of its value is the name, because reviewers recognize the intent from it. Many class structures in the 1994 catalog make up for missing language features. With first-class functions, sum types, generics and modules, most of them shrink to a function, a union or a module-level value.

Related: the coding-standards skill (naming, KISS, YAGNI), the error-handling skill (Result types), the hexagonal-architecture skill (ports are Strategy and Adapter at architecture scale), the ddd-patterns skill (Repository, Specification, value objects), the refactor-cleaner agent (deleting dead abstractions) and the `legacies:type-design-analyzer` subagent (reviewing the types a pattern introduces).

## Decide before reaching for a pattern

1. **Name the force in one sentence.** For example: "Discount rules vary by customer tier and change monthly, and checkout must not change with them." If you can't write the sentence, there's no pattern to apply yet.
2. **Wait for the second real variant.** The first abstraction is a guess about the future. Write the direct code, then abstract once the second or third case shows what actually varies.
3. **Try the language feature before the class form** (see the table). Promote a function to an interface only when the variant has several related operations, owns state with a lifecycle, or must be registered, configured or serialized by name.
4. **Pick the axis of extension.** If new variants arrive often and the operations are fixed, use an interface with polymorphism. If the variants are fixed and new operations arrive often, use a closed sum type with exhaustive matching. Most pattern pain comes from choosing the wrong axis.
5. **Make every indirection pay.** An interface, factory or layer has to buy something real: a second implementation, a test seam at an I/O boundary, or an ownership boundary. "We might need it" doesn't count.
6. **Prefer composition to inheritance.** Inherit only for a stable is-a relation inside one module, at most two levels deep.
7. **Name types for their domain role.** Use `PricingRule`, `TaxPolicy` and `OrderPlaced`, not `PricingStrategyImpl` or `OrderFactoryProvider`.

## When to use each, when not, and the modern form

| Pattern | Use when | Skip when | Idiomatic modern form |
|---|---|---|---|
| Strategy | The algorithm is chosen at runtime from data or config | One algorithm, or the choice is fixed at build time | A function parameter, or a map from key to function |
| Factory | Callers must not know the concrete type; creation can fail or pools resources | `new X()` with no logic | A static factory that returns a Result; the composition root; a DI container |
| Builder | Many optional parts, staged validation, an immutable result | A handful of fields | Named or keyword arguments (C#, Python), an object literal with defaults (TS), functional options (Go), `with` on records (C#) |
| Singleton | One per process for a real resource (connection pool, SDK client) | Global mutable state, service locator | Create once in the composition root and inject; DI singleton lifetime; `sync.OnceValue` (Go 1.21+) |
| Adapter | A third-party or legacy API must fit your interface | You own both sides | A thin wrapper module; an anti-corruption layer at context edges |
| Decorator | Stackable cross-cutting behavior on one interface (cache, metrics, retry) | The behavior is needed at one call site | A higher-order function, a Python decorator, a middleware pipeline, DI decoration |
| Observer | Independent reactions whose failure must not fail the source | You need the result or an order, or there's one listener | Callbacks, events, domain events |
| Command | Operations are queued, logged, retried, undone or sent over the wire | It's an ordinary method call | A plain data record plus a handler function |
| State | Many states with guarded transitions and state-specific data | Two or three states | A union of state types plus a transition function |
| Visitor | Many operations over a closed hierarchy in a language without pattern matching | The language has sealed types and exhaustive matching | A sum type plus `switch` or `match` |
| Template Method | A framework skeleton with a few stable hooks | Application code, or subclasses override most steps | Pass the varying steps in as functions |
| Chain of Responsibility | Ordered handlers that may short-circuit | A fixed sequence | An array of functions or a middleware pipeline |
| Repository | Aggregates persisted behind a domain-facing interface | CRUD screens where the ORM already is the unit of work | One repository per aggregate (ddd-patterns); query services for reads |
| Specification | Business predicates reused both in memory and in queries | A single filter | Predicate functions or query objects |
| Null Object | A safe default collaborator (no-op logger, empty policy) | It hides data that is missing by mistake | An explicit optional, handled at the call site |
| Facade | Most callers need a simple view of a subsystem | It wraps one class one-to-one | A module with a small exported surface |

Patterns that rarely earn their place in application code:
- Flyweight, until profiling shows memory pressure.
- Prototype: use `structuredClone`, `copy.deepcopy` or a record `with` instead.
- Memento: keep immutable snapshots.
- Interpreter: use a parser library.
- Mediator: it tends to grow into a god object.

## How language features change the patterns

**First-class functions.** Strategy, Command, Template Method, Observer and simple factories become functions and closures.

```ts
type PriceRule = (order: Order) => Money;

const rules: Record<Tier, PriceRule> = {
  standard: basePrice,
  gold: (order) => basePrice(order).times(0.9),
};

const price = rules[order.tier](order); // a new tier is one entry, not a class
```

**Sum types with exhaustive matching.** A closed set of variants with a checked match replaces Visitor and most State class hierarchies. When you add a variant, every match that has to handle it stops compiling. That breakage is the point.

```ts
type Payment =
  | { kind: "card"; last4: string }
  | { kind: "invoice"; dueDays: number };

function label(p: Payment): string {
  switch (p.kind) {
    case "card": return `Card ending ${p.last4}`;
    case "invoice": return `Invoice, due in ${p.dueDays} days`;
    default: {
      const unhandled: never = p; // compile error once a variant is added
      throw new Error(`Unhandled payment: ${JSON.stringify(unhandled)}`);
    }
  }
}
```

- **Java 21+**: declare `sealed interface Payment permits Card, Invoice` and implement it with records. A pattern `switch` that covers every permitted type compiles without `default`.
- **C#**: before C# 15, an abstract record hierarchy is open. The compiler warns that a switch expression isn't exhaustive even when every subtype is handled, and the discard arm you add to silence it then hides missing cases. C# 15 adds `union` types and `closed` classes, and checks switch expressions over them for exhaustiveness. It ships with .NET 11 and was in preview as of 2026-10.
- **Python 3.10+**: use `match` over frozen dataclasses joined in a `Card | Invoice` alias. Only the type checker checks exhaustiveness, through `assert_never` (3.11+, `typing`) in the fallback arm, so run mypy or pyright in CI.
- **Go**: there are no sum types. Use an interface with an unexported marker method plus a `//sumtype:decl` comment, a type switch whose `default` panics, and the `gochecksumtype` linter in golangci-lint to flag missing cases.
- Don't switch on type where other modules add variants. Those variants belong on the polymorphism axis.

**Generics.** Generics replace `Object`-and-cast containers and type-parameterized skeletons such as `Result<T, E>`, `Page<T>` or a typed event bus. Don't use them to force one abstraction over unrelated domain types: a `BaseRepository<T>` with the same CRUD for every entity leaks persistence and erases intent. In Go, use generics for containers and algorithms, and keep behavior in small interfaces declared where they're used.

**Modules and DI.** A module-level value already is a singleton. The real cost of Singleton was global access, not having one instance. Build shared instances in the composition root and pass them in (hexagonal-architecture skill). For resource lifecycles, Python `with`, Java try-with-resources, C# `using` and Go `defer` replace Template Method.

**Patterns that replace classic ones:**
- *Make invalid states unrepresentable.* A smart constructor parses raw input into a type that can only hold valid values, often returning a Result, so code downstream never re-checks it.
- *Typestate.* Model a lifecycle as separate types (`DraftOrder` to `PlacedOrder`) so that calling an operation in the wrong state doesn't compile.
- *Functional core, imperative shell.* Keep decisions in pure functions and push I/O to the edges. This makes strategy and state logic testable without mocks.

## Smells and their fixes

Too much structure:
- **An interface with one implementation and no I/O boundary behind it.** Inline it, and recreate it when a second variant appears. Ports to databases and external APIs are the exception, because the test fake is their second implementation.
- **A factory that only calls a constructor, or a builder for three fields.** Call the constructor, or use a literal.
- **An abstract base class with one subclass, or a template method whose subclasses override most hooks.** Compose functions instead.
- **Strategy objects selected by the same `if`/`else` at every call site.** The selection is the real variation, so move it into one lookup keyed by data.
- **A Visitor over a three-variant type in a language with pattern matching.** Replace it with a sum type and a match.
- **An event published and handled in the same module to "decouple" two steps that always run together.** Make it a direct call. Events are for reactions that may fail, lag or scale independently.
- **An in-process mediator in front of every call.** It hides the call graph, and go-to-definition lands on the dispatcher. Call the handler directly unless you use the mediator's pipeline behaviors.
- **A generic `BaseService<T>` or `BaseRepository<T>`.** Write specific operations per use case or aggregate.
- **A plugin registry or config-driven dispatch with one plugin.** Make it a direct call.
- **Stacked pattern names** (`OrderStrategyFactoryProvider`). The responsibility is unclear. Rename the type after the domain concept and remove layers.

Too little structure:
- **The same type switch over an open hierarchy, repeated across files.** Use polymorphism.
- **Boolean flags that select behavior** (`render(doc, true, false)`). Split into separate functions, or take a strategy parameter.
- **Many positional parameters of the same type.** Use an options object, named arguments or a builder.
- **`new ConcreteClient()` inside business logic.** Inject the dependency.
- **Mutable global state read from many places.** Pass it explicitly, then check whether it really needs to be shared.

## Refactoring toward and away from a pattern

Pin the current behavior with characterization tests first (the tdd-workflow skill has the loop). Then move in steps that each compile and pass.

- **Toward Strategy**: extract the varying branch into a function and make it a parameter. Promote the function type to an interface only if you need to.
- **Replacing a conditional**: use polymorphism, or a lookup table when the variants differ only in data or in a single function.
- **Toward Factory**: replace the constructor with a factory function when creation can fail (return a Result) or has to choose a subtype.
- **Away from Singleton**: add a constructor parameter that defaults to the global, migrate callers to pass it explicitly, then remove the default and the global accessor.
- **Away from a single-implementation interface**: point callers at the class, keep its name, and delete the interface.
- **Away from Visitor**: introduce the sum type, port one operation at a time to a match, and delete `accept` and `visit` last.
- **Away from inheritance**: turn the overridden hooks into function fields, then pass functions in instead of subclassing.

Delete the leftover scaffolding in the same change or right after it. The refactor-cleaner agent finds what's left.

## Review checklist

- [ ] Every pattern has a named force and either a second real variant or an I/O boundary behind it.
- [ ] The language feature (function, union with match, generic, module) was tried before the class form.
- [ ] Matches over sum types are checked for exhaustiveness (`never`, sealed or `closed` types, `assert_never`, gochecksumtype).
- [ ] No singleton is reached through global access; shared instances come from the composition root.
- [ ] Inheritance stays inside one module and at most two levels deep.
- [ ] Types are named for domain roles, not pattern mechanics.
- [ ] Removing the pattern would cost a capability you need, not just some lines.
- [ ] Refactors kept the tests green at each step and deleted the dead scaffolding.

<!-- Written for legacies (MIT). Checked against: https://openjdk.org/jeps/441, https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15, https://docs.python.org/3/library/typing.html, https://pkg.go.dev/sync#OnceValue, https://golangci-lint.run/docs/linters/, https://github.com/alecthomas/go-check-sumtype, 2026-10 -->
