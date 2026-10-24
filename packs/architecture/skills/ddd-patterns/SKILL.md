---
name: ddd-patterns
description: Domain-driven design applied to real codebases. Covers strategic design (bounded contexts, context maps, ubiquitous language), tactical design (aggregates sized around invariants, entities vs value objects, one repository per aggregate, domain events, domain services, anti-corruption layers) and a light version for CRUD-heavy apps. Use when modeling a domain, drawing module or service boundaries, designing an aggregate, or when someone mentions DDD, bounded context, aggregate root, value object or anemic model.
---

# Domain-Driven Design Patterns

DDD pays off where the business rules are the hard part. This skill covers the model and its boundaries. The hexagonal-architecture skill covers ports, adapters and layering, the cqrs-event-sourcing skill covers event-sourced aggregates and projections, and the microservices-patterns skill covers running contexts as separate services. The `legacies:type-design-analyzer` subagent can review value objects and typed IDs.

## Decide how much DDD each area gets

- **Core subdomain**: the rules that set the business apart, change often and span several fields or entities. Use the full tactical model here.
- **Supporting subdomain**: needed, but not what sets the business apart. Transaction scripts or active record are fine; just keep the boundary clean.
- **Generic subdomain** (identity, payments, email, search): buy or reuse it, and wrap the product in an anti-corruption layer.
- Signs that a model needs DDD:
  - bugs where "this state should be impossible";
  - the same rule copied across controllers and jobs;
  - words the domain experts use that appear nowhere in the code;
  - status fields with implicit transitions.
- It doesn't need DDD when the work is forms over tables, single-field validation or reporting. Don't impose aggregates and repositories there.

### DDD-lite for CRUD-heavy apps

Five moves give most of the value without adding layers:
1. Value objects for money, quantities, email addresses, date ranges and IDs.
2. Behavior on the ORM entity, named in domain language (`invoice.markPaid(payment)`), with private setters and the invariants checked there instead of in controllers.
3. One module per business area, with an explicit public surface and no reaching into another module's tables.
4. Screens and reports that read through queries returning DTOs, not by loading entities.
5. A glossary in the repository that code names follow.

Add separate persistence models, domain events and repositories over the ORM only when a concrete rule needs them.

## Strategic design

- **Ubiquitous language is per context.** "Customer" means a lead with a pipeline stage in Sales, a payer with tax data in Billing and a ticket requester in Support. A single shared `Customer` class turns into a canonical model that every team fights over. Give each context its own small types, and share only IDs and published contracts.
- **A bounded context** is the boundary inside which one model and one language stay consistent, owned by one team. It maps to a module in a monolith or to a service, and doesn't have to be a microservice.
- **Draw boundaries** along business capabilities and wherever a word changes meaning or the rate of change, consistency needs or owners differ. Don't draw them by entity (a `CustomerService` doing CRUD) or by technical layer.
- **Map every integration**, because the relationship decides who adapts to whom:

| Relationship | What it means | Choose it when |
|---|---|---|
| Partnership | Two teams plan releases together | Shared goal, close cooperation |
| Shared kernel | A small model that both teams own | Both teams can absorb coordinated change; keep it tiny and versioned |
| Customer–supplier | Upstream plans for downstream's needs | Downstream has leverage over upstream's priorities |
| Conformist | Downstream adopts upstream's model as-is | Upstream's model is good enough and you have no leverage |
| Anti-corruption layer | Downstream translates upstream's model | Upstream is legacy, foreign or unstable |
| Open host service + published language | Upstream publishes a stable, documented protocol | There are many consumers |
| Separate ways | No integration; each side duplicates what it needs | Integrating costs more than duplicating |

- Contexts integrate through IDs, APIs and published events. They never share tables, ORM entities or a common domain package.

## Tactical design

### Value objects first

- Value objects are immutable, compared by value, validated on construction, and their behavior has no side effects (`Money.add`, `DateRange.overlaps`). Default to a value object. Make something an entity only when it has identity and a lifecycle.
- Typed IDs stop an `OrderId` from being passed where a `CustomerId` belongs. Use branded types in TypeScript, `readonly record struct` in C#, records in Java, and `NewType` in Python (which only the type checker enforces).
- Money keeps the amount and currency together, never uses binary floating point, and owns its rounding rule.
- Persist value objects as embedded columns (JPA `@Embeddable`, EF Core complex or owned types), or as a JSON column for small collections. A value object doesn't get its own table with an identity.

### Entities

- An entity has identity and a lifecycle, and equality is by ID. Expose operations that state the intent (`order.cancel(reason)`), not setters (`order.setStatus(...)`).
- Construct valid or not at all: constructors and factories enforce the invariants. If the ORM needs a parameterless constructor, make it private or protected.

### Aggregates: size them by invariants

1. An aggregate is a transactional consistency boundary. It holds what must be consistent at commit and nothing more. For each pair of entities, ask which invariant would break if they lived in separate aggregates. If none would, separate them.
2. Outside code holds references only to the root, and children change only through the root's methods.
3. Refer to other aggregates by ID, never by object reference or ORM navigation property.
4. By default, change one aggregate per transaction. Rules that span aggregates become eventually consistent through domain events or a process manager. If the business truly needs two aggregates to change atomically, redraw the boundary instead of quietly writing both.
5. Put a version on the root for optimistic concurrency (JPA `@Version`, an EF Core concurrency token, `WHERE version = ?` in SQL). Small aggregates mean fewer conflicts.
6. Load the whole aggregate and never lazy-load inside a domain method. If it's too big to load, it's too big.
7. An unbounded child collection (comments on a post, entries in a ledger) means the child is an aggregate of its own. A rule like "at most three open tickets per customer" can be enforced with a query plus a unique or partial index, or relaxed after asking the domain expert.

```ts
export class Order {
  private readonly pending: DomainEvent[] = [];

  private constructor(
    readonly id: OrderId,
    private status: "draft" | "placed" | "cancelled",
    private readonly lines: OrderLine[],
    readonly version: number,
  ) {}

  addLine(productId: ProductId, quantity: Quantity, unitPrice: Money): void {
    if (this.status !== "draft") throw new OrderNotEditable(this.id);
    if (this.lines.length >= MAX_LINES) throw new TooManyLines(this.id, MAX_LINES);
    this.lines.push(OrderLine.create(productId, quantity, unitPrice));
  }

  place(at: Date): void {
    if (this.lines.length === 0) throw new EmptyOrder(this.id);
    this.status = "placed";
    this.pending.push({ type: "OrderPlaced", orderId: this.id, total: this.total(), at });
  }

  takeEvents(): DomainEvent[] {
    return this.pending.splice(0); // the application service publishes these after saving
  }
  // total(), create() and rehydrate() omitted
}
```

Mutation stays behind the root's methods. A style where each method returns a new aggregate plus its events works just as well, and fits event sourcing.

### Repositories

- Write one repository per aggregate root, in domain terms (`orders.get(id)`, `orders.add(order)`, `orders.save(order)`). The interface lives in the domain or application layer and the implementation in infrastructure; in hexagonal-architecture terms it's a port.
- Don't add repositories for child entities, per-field update methods, an `IQueryable` or query builder leaking out, or a `BaseRepository<T>` with the same CRUD for everything.
- Add finders only for what commands need (`findPendingOlderThan(cutoff)`). Screens and reports use query services that return DTOs straight from SQL or ORM projections.
- The ORM session (EF Core `DbContext`, JPA `EntityManager`, SQLAlchemy `Session`) already is a unit of work. Use one transaction per command handler, and don't wrap the session in a homemade unit of work.

### Domain events

- Domain events are past-tense facts in the ubiquitous language (`OrderPlaced`, `PaymentCaptured`). They carry IDs, plus the facts consumers can't cheaply work out for themselves.
- The aggregate records them, and they're dispatched after the change is persisted. In-process handlers that change other aggregates run in their own transactions. If you take the shortcut of running them in the same transaction, write that decision down.
- Anything that leaves the process (other contexts, email, webhooks) goes through a transactional outbox, never straight from inside the database transaction. The cqrs-event-sourcing skill has the mechanics.
- Domain events stay inside the context. Other contexts get separate integration events with a versioned contract. Never serialize domain classes onto the bus.
- Commands are requests that can be refused (`PlaceOrder`); events are facts that already happened. `ValidateOrderRequested` is a command with an event's name.

### Domain services and application services

- A domain service holds a rule that belongs to no single entity or value object, such as pricing from a cart plus a customer's contract, or a transfer policy between two accounts. It's stateless, does no I/O and speaks the domain language.
- An application service (or command handler) loads aggregates, calls domain behavior, saves and publishes. It owns the transaction, authorization and idempotency, and contains no business rules.

### Anti-corruption layer

- An anti-corruption layer (ACL) is an adapter plus a translator at the edge of your context. It maps the upstream's types, statuses, error codes and quirks to your value objects and domain errors, and the upstream's vocabulary stops there.
- Keep it in infrastructure behind a port. Test it against recorded upstream payloads or contract tests. Reject or log input you can't translate instead of guessing a default.
- The same shape lets you strangle a legacy system: the new context talks to the legacy model only through an ACL.

```python
class CrmCustomerDirectory(CustomerDirectory):  # port owned by our context
    def __init__(self, crm: CrmClient) -> None:
        self._crm = crm

    def find(self, customer_id: CustomerId) -> Customer | None:
        account = self._crm.get_account(str(customer_id))
        if account is None or account["acct_state"] == "PURGED":
            return None
        return Customer(
            id=customer_id,
            tier=tier_from_crm_segment(account["seg_cd"]),  # raises on unknown codes
            email=Email.parse(account["primary_email"]),
        )
```

## Common mistakes

- **Anemic model in a core domain.** The entities are bags of properties and the services hold every rule. Move each rule onto the object that owns the data it checks, and keep services for orchestration. An anemic model is fine in a supporting CRUD context.
- **Giant aggregate** (a Customer holding Orders holding Lines holding Payments). It causes lock contention, version conflicts and slow loads. Split it along invariants, refer to other aggregates by ID, and use events between them.
- **Leaking ORM entities.** Symptoms: lazy-loading proxies inside domain logic, ORM entities returned from API endpoints, and mapping annotations dictating the model. Keep the mapping outside the domain:
  - EF Core fluent configuration in infrastructure;
  - SQLAlchemy imperative mapping with `registry.map_imperatively`;
  - JPA's `orm.xml` mapping file, or a separate persistence model.

  Map API DTOs at the edge. A full separate persistence model doubles the code, so use one only where the mapping fights the ORM.
- **Primitive obsession** (strings and decimals everywhere). Use value objects and typed IDs.
- **A repository per table, or a generic repository.** Use one repository per aggregate.
- **A domain library shared across contexts.** Give each context its own model, and share only IDs and published contracts.
- **Every context becomes a microservice.** Start with context modules in a modular monolith (microservices-patterns skill).
- **Language drift** (`status = 3`, `type_flag`, `processData()`). Name enums and methods in the business's words, and rename the code when the language changes.
- **Tests and seed data that write rows directly.** They create states the model forbids. Build test data through factories or builders that go through the invariants.
- **The same rule in the UI, the API validation and the domain.** Validate shape at the edge, and enforce business invariants once, in the model.
- **Hidden inputs** (`now()`, random IDs, config singletons inside domain code). Pass in a clock, an ID generator or the values themselves.

## Enforcing boundaries

Give each bounded context its own top-level module. Its public surface is its application services, published DTOs and events. Fail the build on violations with:
- ArchUnit or Spring Modulith (Java);
- ArchUnitNET (.NET);
- import-linter (Python);
- dependency-cruiser or eslint-plugin-boundaries (TypeScript);
- `internal/` packages (Go).

## Review checklist

- [ ] Tactical patterns appear only where the subdomain's rules warrant them; CRUD areas stay simple.
- [ ] Code names match the context's glossary, and no domain class is shared across contexts.
- [ ] Each aggregate boundary is justified by a named invariant, and other aggregates are referenced by ID.
- [ ] One aggregate changes per transaction, or the exception is documented.
- [ ] Roots carry a version for optimistic concurrency, and domain methods never lazy-load.
- [ ] Value objects are immutable and self-validating, and IDs are typed.
- [ ] There's one repository per aggregate, and reads go through query services and DTOs.
- [ ] Domain events are past tense, recorded by the aggregate, and leave the context only as versioned integration events through an outbox.
- [ ] Upstream models are translated in an ACL, and their terms don't appear in the domain.
- [ ] ORM and API types don't leak into the domain layer, and module boundaries are checked in CI.

<!-- Written for legacies (MIT). Checked against: https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew, https://docs.sqlalchemy.org/en/20/orm/mapping_styles.html, https://www.archunit.org/, https://github.com/TNG/ArchUnitNET, https://docs.spring.io/spring-modulith/reference/verification.html, https://import-linter.readthedocs.io/en/stable/, https://github.com/sverweij/dependency-cruiser, https://github.com/javierbrea/eslint-plugin-boundaries, 2026-10 -->
