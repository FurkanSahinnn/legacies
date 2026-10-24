---
name: microservices-patterns
description: Microservice architecture decisions and the patterns that keep distributed systems correct. Covers when not to split (modular monolith first), decomposition by business capability, sync vs async calls, API gateway and BFF, sagas, outbox, inbox and idempotency keys, timeouts, retries, circuit breakers, data ownership, contract tests, trace propagation, deployment and versioning. Use when splitting a monolith, designing service-to-service calls or a distributed workflow, or debugging cascading failures or duplicate or lost messages between services.
---

# Microservices Patterns

Services buy independent deployment, scaling and ownership for separate teams. The price is every distributed-systems failure mode, such as partial failure, duplicates, reordering and eventual consistency, plus harder debugging, testing and refactoring. Make sure the price is worth paying before you apply anything below.

Related:
- the ddd-patterns skill (bounded contexts are the service candidates);
- the cqrs-event-sourcing skill (outbox, idempotent handlers and ordering in depth);
- the error-handling skill (retry and backoff code);
- the contract-first skill (api-design pack);
- the deployment-patterns skill (deployment pack);
- the architect agent.

## Don't split yet

- **Start with a modular monolith**: one deployable, with one module per bounded context.
  - Each module owns its tables, in its own schema when possible.
  - Modules talk only through public interfaces or in-process events.
  - Enforce the boundaries in CI. The ddd-patterns skill lists tools per language, and Spring Modulith verifies module structure in Spring apps.
- **Extract a module only for a concrete reason**:
  - a different scaling or runtime profile (GPU work, bursty ingestion);
  - a separate team that needs its own release cadence;
  - failure or compliance isolation (PCI or health-data scope);
  - a technology the rest of the system can't host.

  Messy code is a modularity problem, and distributing it makes it worse.
- **Have the prerequisites in place**: a pipeline per service, central logs, metrics and traces, automated environments and on-call ownership. Without them, stay in the monolith.
- **Extract with a strangler.** Route one capability through a facade or the gateway to the new service, sync its data through events, cut over, then delete the old path.
- **Watch for distributed-monolith smells**: services that must deploy together, features that touch several services, chains of synchronous calls per request, a shared database, a shared domain library.

## Decomposition and data ownership

- Split by business capability or bounded context (pricing, fulfillment, billing). Never split by entity (a `CustomerService` doing CRUD) or by technical layer.
- Test each boundary by asking whether the service can handle its main use cases with its own data. If most requests fan out to three other services, either the boundary is wrong or the service needs a local, event-fed replica of the data it reads.
- Each service owns its data. No other service reads or writes its tables, not even for reporting. Reporting gets a change-data-capture or event feed into an analytics store.
- Shared libraries carry only technical concerns (telemetry, auth clients) and are versioned. They never contain domain models.

## Communication

- **Synchronous HTTP or gRPC**: use it when the caller needs the answer to continue.
  - Availability multiplies along a chain: five dependencies at 99.9% each give about 99.5% if their failures are independent.
  - Keep chains short, and never call back into the caller.
- **Asynchronous messaging**: use it to propagate state changes, for long-running work and for fan-out. You pay with eventual consistency, duplicates, reordering and harder tracing.
- **Commands vs events**: commands go to one owner and can be refused (`ReserveStock`). Events announce facts to whoever cares (`OrderPlaced`). An event that exactly one service is expected to act on is a command in disguise.
- **Queries across services**: use API composition in a BFF for simple joins, and a read model built from events for heavy or high-volume ones.
- **API gateway**: routing, TLS, authentication, coarse authorization, and rate and size limits. It holds no business rules and no workflow orchestration.
- **Authorization**: services still authorize every request themselves, because internal callers bypass the gateway. Authenticate service-to-service calls with mTLS or signed tokens.
- **Backend for frontend (BFF)**: one per client type (web, mobile, partner), owned by that client's team, shaping and aggregating responses. A single shared BFF grows into a new monolith.

## Sagas

Don't use distributed transactions (2PC or XA) across services. A saga is a sequence of local transactions, each with a compensating action.

- **Orchestration**: a coordinator persists the saga's state and tells participants what to do.
  - Use it for more than about three steps, for branching and timeouts, or whenever someone must answer "where is order 123?".
  - Either a workflow engine (Temporal, AWS Step Functions, Camunda) or a process-manager table works. Keep domain rules in the participants.
- **Choreography**: each service reacts to the previous one's events. It's fine for two or three steps. Beyond that the flow is implicit, cycles creep in and nobody owns failures.
- **Order the steps**:
  1. Compensatable steps.
  2. The pivot, the point of no return, such as capturing a payment.
  3. Steps that can only be retried until they succeed (ship, notify).
- **Compensations are business actions** (refund, release a reservation), not rollbacks. They must be idempotent and retryable. Actions that can't be undone, such as sending an email, go after the pivot.
- **Sagas have no isolation**: other requests see intermediate states. Protect against that with one of:
  - semantic locks (a `PENDING` status that blocks conflicting commands);
  - commutative updates;
  - re-validation at the pivot.
- **Every step has a timeout**, and stuck sagas show up on a dashboard or in a manual-resolution queue.

## Reliable messaging and idempotency

- **Transactional outbox (producer).** The state change and the message commit in one local transaction, and a relay publishes the message, by polling with `FOR UPDATE SKIP LOCKED` or through change data capture. Never save and then publish.
- **Inbox (consumer).** Record the message ID in the same transaction as the effect, so a unique key turns a redelivery into a no-op. Keep IDs at least as long as the broker can redeliver.
- **Idempotency keys for non-idempotent HTTP calls** (payments, order placement). The client creates one key per logical operation and resends it on every retry.
  - The IETF `Idempotency-Key` header draft (not an RFC) suggests these responses:

    | Situation | Status |
    |---|---|
    | A required key is missing | 400 |
    | A key is reused with a different payload | 422 |
    | The first request is still in flight | 409 |

  - Store the key, a request fingerprint and the response atomically with the effect, and publish the expiry period.
- **Never retry a non-idempotent call without a key.** Design retries and idempotency together.

```sql
-- Inbox: runs in the same transaction as the consumer's business update
INSERT INTO inbox (consumer, message_id) VALUES ('billing', $1)
ON CONFLICT DO NOTHING;  -- 0 rows inserted means a duplicate, so skip the effect
```

## Timeouts, retries and circuit breakers

1. **Give every remote call a timeout.** Defaults are often infinite: Go's `http.Client` with a zero `Timeout`, Python `requests` without `timeout=`, and gRPC calls without a deadline.
2. **Propagate a deadline instead of fixing a timeout per hop.** Each hop gets the caller's remaining budget minus its own work. gRPC propagates deadlines, by default in Java and Go. Over HTTP, pass the remaining budget explicitly and honor cancellation.
3. **Retry only transient failures**: connection errors, 503, 429 with `Retry-After`, and timeouts on idempotent operations. Use exponential backoff with jitter, two or three attempts, all within the overall deadline.
4. **Retry at one layer only.** Three attempts at each of four layers means up to 81 calls on the bottom service during an outage. Check what already retries:
   - Istio's default route policy retries twice on connection failures, refused streams, `unavailable` and `cancelled`.
   - The .NET standard resilience handler (Microsoft.Extensions.Http.Resilience) retries every HTTP method, POST included, unless you call `options.Retry.DisableForUnsafeHttpMethods()`.
5. **Cap retries with a budget or a throttle**, so they stay a small fraction of traffic (gRPC retry throttling, mesh retry budgets).
6. **Put a circuit breaker on each downstream dependency.** It opens when the failure or slow-call rate over a window crosses a threshold, fails fast while open, and sends probe calls in the half-open state.
   - Pair it with a deliberate fallback (a cached or degraded response) or a fast, explicit error. Never fall back silently to wrong data for money, stock or authorization.
   - Libraries: Resilience4j for Java (Hystrix is in maintenance mode), Polly through Microsoft.Extensions.Http.Resilience for .NET, opossum for Node.js. A service mesh can do this too.
7. **Isolate dependencies with bulkheads**: separate connection pools and concurrency limits per dependency, so one slow dependency can't take every thread. When saturated, shed load with a fast 503 instead of queueing without limit.
8. **Keep dependencies out of liveness probes.** If a liveness probe checks the database, a database outage restarts every pod. Readiness probes may check dependencies.

## Contracts, versioning and deployment

- **Stay compatible with version N−1.** Services deploy independently, so old and new versions run side by side during every rollout, and so do old and new message producers and consumers. Every API and message change must still work with the previous version.
- **Evolve by expand and contract.** Add optional fields or new endpoints, migrate consumers, and remove the old shape once usage reaches zero. Version a URL or message type only for a genuinely breaking change. Consumers ignore unknown fields.
- **Prefer contract tests to shared end-to-end environments.** Either:
  - use consumer-driven contracts with Pact, gated by `can-i-deploy` against what each environment runs; or
  - check provider schemas for breaking changes: `buf breaking` for protobuf, schema-registry compatibility for events, an OpenAPI diff in CI.
- **Database changes** follow the same expand-and-contract rule, because old code keeps running during the rollout (database-migrations skill).
- **Decouple deploy from release** with feature flags, and roll out by canary with automatic rollback on error-rate or latency SLOs (deployment-patterns skill).

## Observability

- **Propagate W3C Trace Context** (`traceparent` and `tracestate`) on every hop, message headers included. Under OpenTelemetry's messaging conventions, the producer attaches a creation context to each message and the consumer's processing span links to it. For batches, links are the only option, because a span has only one parent.
- **Structure logs** and include the trace and span IDs plus business keys: order ID, saga ID, message ID, idempotency key.
- **Keep personal data and secrets out of baggage.** Baggage is forwarded to every downstream call, third parties included.
- **Measure each service**: request rate, errors and duration per endpoint and per consumer, plus saturation (pool usage, queue depth, consumer lag). Set SLOs per user journey, and alert on symptoms.
- **Choose sampling deliberately.** Head sampling is cheap but can't guarantee it keeps the traces with errors. Tail sampling, for example in the OpenTelemetry Collector, keeps the error and slow traces.

## Review checklist

- [ ] The reason for each split is written down, and a modular monolith was considered first.
- [ ] Boundaries follow business capabilities, with no shared database and no shared domain library.
- [ ] Every remote call has a timeout and propagates the deadline.
- [ ] Retries happen at one layer, only for transient errors, with backoff, jitter and a budget.
- [ ] Non-idempotent operations carry idempotency keys, and consumers deduplicate through an inbox.
- [ ] There are no dual writes; producers use an outbox.
- [ ] Each dependency has a circuit breaker with an explicit fallback, and bulkheads isolate slow dependencies.
- [ ] Sagas define compensations, a pivot, timeouts and visible state.
- [ ] API and message changes are compatible with N−1 and verified by contract tests in CI.
- [ ] Trace context flows through HTTP and messaging, and logs carry trace and business IDs.
- [ ] Liveness probes don't depend on downstream services.

<!-- Written for legacies (MIT). Checked against: https://docs.spring.io/spring-modulith/reference/verification.html, https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html, https://pkg.go.dev/net/http#Client, https://requests.readthedocs.io/en/latest/user/advanced/#timeouts, https://grpc.io/docs/guides/deadlines/, https://grpc.io/docs/guides/retry/, https://istio.io/latest/docs/reference/config/networking/virtual-service/, https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience, https://resilience4j.readme.io/docs/circuitbreaker, https://github.com/Netflix/Hystrix, https://github.com/nodeshift/opossum, https://docs.pact.io/pact_broker/can_i_deploy, https://buf.build/docs/breaking/, https://www.w3.org/TR/trace-context/, https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/, https://opentelemetry.io/docs/concepts/signals/baggage/, https://opentelemetry.io/docs/concepts/sampling/, 2026-10 -->
