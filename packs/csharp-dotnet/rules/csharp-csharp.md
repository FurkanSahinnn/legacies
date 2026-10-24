---
paths:
  - "**/*.cs"
  - "**/*.csproj"
  - "**/appsettings*.json"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/csharp/coding-style.md, rules/csharp/patterns.md, rules/csharp/security.md, rules/csharp/testing.md, rules/csharp/hooks.md -->
# C#

## Style and types
- Nullable reference types enabled; explicit access modifiers; one primary type per file, named after it.
- `record` or `record struct` for immutable value-like models and DTOs, `class` for entities with identity and lifecycle, `interface` at service boundaries. No `dynamic`: use generics or explicit models.
- Immutability: `init` setters, constructor parameters, `with` expressions and read-only collections (`IReadOnlyList<T>`) for shared state; never mutate an input model to produce new state.
- Format with `dotnet format` (it also applies analyzer fixes) and remove unused `using`s. Expression-bodied members only while they stay readable.

## Async and errors
- `async`/`await` end to end; never block with `.Result` or `.Wait()` (deadlocks, thread-pool starvation). Async methods end in `Async` and take a `CancellationToken` that is passed down.
- Throw specific exceptions; rethrow with `throw;` to keep the stack trace. Log with message templates, not interpolation: `logger.LogError(ex, "Failed to load order {OrderId}", orderId)`.

## Configuration and DI
- Bind config sections to strongly typed options classes (`IOptions<T>`, `required` and `init` properties) instead of reading raw `Configuration["..."]` strings across the codebase.
- Depend on interfaces at service boundaries; a constructor with too many dependencies means the class should be split. Choose lifetimes deliberately: singleton for stateless shared services, scoped for per-request data, transient for lightweight stateless workers.

## Security
- Secrets: user-secrets locally, environment variables or a secret manager in production; `appsettings*.json` never holds real credentials. Fail fast when one is missing (`?? throw new InvalidOperationException(...)`).
- Validate DTOs at the boundary (data annotations, FluentValidation or guard clauses) and reject invalid model state before business logic runs.
- Use the framework's authentication handlers, not hand-rolled token parsing, and enforce authorization policies at the endpoint or handler.

## Testing
- Default to xUnit, AwesomeAssertions, and NSubstitute or Moq unless the repo uses others; Testcontainers when integration tests need real infrastructure.
- `tests/` mirrors `src/`; test names state the behavior: `FindByIdAsync_ReturnsOrder_WhenOrderExists`.
- API integration tests go through HTTP with `WebApplicationFactory<Program>`, so auth, validation and serialization run through the real middleware.
- Verify with `dotnet build` and `dotnet test`.
