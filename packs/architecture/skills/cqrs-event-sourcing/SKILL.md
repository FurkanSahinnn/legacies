---
name: cqrs-event-sourcing
description: CQRS and event sourcing in production. Covers whether either is worth it, read models and projections (rebuilds, lag, eventual-consistency UX), event design, versioning and upcasting, snapshots, idempotent handlers, the transactional outbox, ordering guarantees, GDPR erasure with immutable events, and given-when-then tests. Use when someone proposes CQRS or event sourcing, designs events or projections, sees duplicate or out-of-order events, or must delete personal data from an event store.
---

# CQRS and Event Sourcing

CQRS separates the model that decides (commands) from the models that answer questions (queries). Event sourcing stores each decision as an immutable event in a per-aggregate stream, and rebuilds state by folding that stream. The two are independent. CQRS without event sourcing is common and cheap. Event sourcing almost always brings CQRS along, because nobody queries raw streams.

Related: the ddd-patterns skill (aggregates, domain events), the microservices-patterns skill (sagas, inbox, contracts across services) and the architect agent for recording the decision.

## Decide first

| Option | Cost | Worth it when |
|---|---|---|
| CQRS-lite: one database, a separate query path that returns DTOs | Low | Almost any app beyond a trivial one; lists and reports skip the domain model |
| Separate read stores fed by events (search index, denormalized tables) | Medium: lag, rebuild tooling, two schemas | Read and write shapes or loads differ widely; full-text, geo or aggregated views |
| Event sourcing | High: versioning forever, a projection per query, replay tooling, a learning curve | History is a requirement (ledgers, compliance); you need past states ("what did we know on 1 March"); state machines with business-meaningful transitions; several read models built from the same facts |

When not to event-source:
- CRUD data that is mostly overwritten.
- Domains dominated by ad-hoc queries over current state.
- A team on a deadline meeting the pattern for the first time.
- When the real need is an audit trail: an audit table, temporal tables or change data capture costs far less.

Choose per aggregate or bounded context, never system-wide.

## Event design

- Record one event per business decision, past tense, in domain language: `OrderPlaced`, `ItemsReserved`, `OrderShipped`. Avoid `OrderUpdated` or `FieldChanged`, which lose the intent and force consumers to diff.
- The payload holds what rebuilding state needs, plus facts that consumers can't recompute later (such as the price and tax rate applied at the time). It is not a dump of the aggregate.
- The envelope metadata carries the event ID, stream ID, stream version, event type, schema version, occurred-at time, correlation ID, causation ID, actor and trace context.
- Events in your store are private. Other contexts get separate, smaller, versioned integration events, translated at the boundary.
- Event type names and field meanings are permanent. Never rename, reuse or repurpose them; a new meaning is a new event type.

## Event store mechanics

- Append with an expected version: `append(streamId, expectedVersion, events)` fails if another writer got there first, and the handler then reloads and retries, or reports a conflict. In SQL, that's a unique constraint on `(stream_id, version)`.
- Projections read events in global-position order, and SQL stores make that subtle. A sequence value is assigned at insert but becomes visible only at commit. So a reader polling for `position > checkpoint` can move past an event that commits late with a lower number, and never see it. To prevent this, do one of the following:
  - use a store that already handles it (Marten holds its high-water mark below any open gap; Axon's JPA and JDBC engines track gaps in their tracking token);
  - serialize appends;
  - read only up to a position that no open transaction can still fill.
- Kafka is a log for integration, not an aggregate event store. It can't append conditionally on a stream's expected version, and it can't load one aggregate's events cheaply.
- Keep streams short by modeling lifecycles, such as one stream per account per period ("closing the books"), instead of relying on snapshots.
- Business rules belong in the decide step. Applying an event (evolve) must never validate, throw or call out, because it runs on every load and has to accept every event ever stored.
- Prefer an existing store: KurrentDB (formerly EventStoreDB), Marten (.NET on PostgreSQL), or Axon Framework with Axon Server (Java). A plain PostgreSQL table works when the needs are small and the gap problem above is handled.

## Read models and projections

- A projection is a deterministic function from events to a read model: no `now()`, no random IDs, no calls to other services, no email. Side effects belong in separate reactors (policies or process managers) with their own idempotency.
- Read models are disposable. Shape each one for a screen or a query, denormalize freely, and rebuild it instead of migrating it.
- Commit the projection's checkpoint in the same transaction as its read-model update. When the read store can't share that transaction, make the update idempotent: upsert by stream ID, and skip events whose version isn't newer than the row's.
- Rebuild side by side:
  1. Project v2 into new tables from position zero while v1 keeps serving.
  2. Switch reads once v2 has caught up.
  3. Drop v1.

  Never truncate a live read model to rebuild it. Know your rebuild time (event count × cost per event) before an incident forces a rebuild. Snapshots don't make projections faster.
- Monitor lag (head position minus checkpoint) for every projection, and alert when a checkpoint stops moving. A poison event should stop a projection and page someone, because skipping it silently corrupts the read model. Reactors may instead park poison messages in a dead-letter store.
- Eventual-consistency UX:
  - Return what the command produced (the new ID, version, computed totals) instead of re-reading a read model.
  - For read-your-writes, return the event's position and have the query wait briefly until the projection has passed it, or show the optimistic value in the UI.
  - Show pending states for long-running work ("Payment processing") rather than a premature success.
  - Update the few read models that must be current inline, in the append transaction (Marten calls these inline projections), and accept the extra write latency.

## Versioning and upcasting

In order of preference:
1. **Additive change**: add a new optional field with a default; consumers ignore fields they don't know (tolerant reader).
2. **New event type** for a new meaning, while old events keep their handler.
3. **Upcaster**: a pure function that turns a stored event's raw JSON at version N into version N+1. Upcasters run on read and are chained, so domain code only knows the latest shape (Axon and Marten both support this). Record the schema version in the envelope.
4. **Copy and transform** into a new stream or store, for splitting, merging or bulk repair. Never edit stored events in place, except for a sanctioned legal erasure.

- Keep a fixture of every historical version of every event type, and test the upcaster chain against them.
- For integration events on a broker, check compatibility in CI with a schema registry or contract tests. Confluent Schema Registry's default `BACKWARD` mode lets new consumers read old data, so consumers must upgrade before producers. Use `FULL` or a `_TRANSITIVE` mode when you can't control the rollout order.

## Snapshots

- A snapshot is an optimization, never the source of truth. Add one only when measured load time hurts, and try shorter streams first.
- It stores the state plus the stream version it covers. Loading reads the snapshot, then applies the events after it.
- Tie the snapshot schema to the aggregate code's version. When the shape changes, discard old snapshots instead of upcasting them; they can always be rebuilt from events.
- Take snapshots asynchronously or every N events, and never let correctness depend on one existing.

## Idempotency, outbox and ordering

- Plan for at-least-once delivery. Kafka's exactly-once guarantee covers reading, processing and writing within Kafka. For any external effect, the consumer must either store its position together with its output or deduplicate.
- Make every handler idempotent:
  - Natural idempotency: set a status, or upsert by key.
  - An inbox table with a primary key on `(consumer, message_id)`, inserted in the same transaction as the effect. A duplicate fails the insert and is skipped.
  - A version check: apply an event only when its version is exactly one past the row's. This catches both duplicates and gaps.
- Never write to the database and then publish to a broker from application code. A crash between the two loses events, or publishes ones that never committed. Use a transactional outbox instead:
  1. Insert the message in the same transaction as the state change.
  2. A relay publishes it, either by polling with `FOR UPDATE SKIP LOCKED` or through change data capture. Debezium's outbox event router routes messages by aggregate type and keys them by aggregate ID.
  3. The relay delivers at least once, so consumers deduplicate by message ID.
- In an event-sourced service, the event store is the outbox. Subscribers read it with a stored checkpoint instead of a second write.
- Ordering exists only per key. Competing consumers and redeliveries reorder messages.

| Broker | Ordered within |
|---|---|
| Kafka | A partition; key by aggregate ID |
| SQS FIFO | A message group |
| Azure Service Bus | A session |
| RabbitMQ | A queue, only when one consumer reads it at a time (single active consumer) |

- Tolerate reordering across aggregates. Within one aggregate, use the stream version to detect gaps, and buffer or retry. A design that needs global ordering should be redesigned.

## GDPR and deletion with immutable events

- Keep personal data out of events where you can. Events carry a subject ID, and the personal data lives in a mutable store you can delete from.
- Use crypto-shredding for personal data that has to be in events. Encrypt those fields with a per-subject key held outside the event store. Erasure deletes the key, and deserialization replaces fields it can no longer decrypt with a placeholder. Whether this counts as erasure under GDPR is debated, so get sign-off from your DPO or legal counsel.
- Erasure must reach every copy: read models, search indexes, caches, analytics exports, broker topics with long retention, logs and backups. On a compacted Kafka topic, a tombstone (a null value) removes earlier values for its key only once compaction has run.
- If your store can delete or truncate streams, confirm the data is physically removed (scavenging, compaction). Record the erasure as an event that contains no personal data.

## Testing with given, when, then

- **Aggregate**: given past events, when a command arrives, expect specific new events or a specific domain error. Use no database and no mocks, and don't assert on private fields.
- **Projection**: given events, including duplicates and out-of-order ones, expect specific read-model rows.
- **Upcasters**: stored fixtures of each version must produce the current shape.
- **Replay**: in CI or staging, rebuild projections from a sanitized, production-sized event set, and check both the results and the duration.

Writing the aggregate as two pure functions makes these tests one-liners:

```ts
// evolve(state, event) -> state and decide(command, state) -> events, both pure
test("an unpaid order cannot ship", () => {
  const state = [placed(id), itemsReserved(id)].reduce(evolve, initialState);
  expect(() => decide(shipOrder(id), state)).toThrow(OrderNotPaid);
});

test("paying a placed order records the payment", () => {
  const state = [placed(id)].reduce(evolve, initialState);
  expect(decide(payOrder(id, amount), state)).toEqual([orderPaid(id, amount)]);
});
```

## Review checklist

- [ ] CQRS or event sourcing was chosen for a stated reason, and only in the contexts that need it.
- [ ] Events are past-tense business facts with a full envelope (ID, stream version, type, schema version, correlation and causation IDs).
- [ ] Appends use expected-version concurrency, and projection readers can't skip events that commit late.
- [ ] Projections are deterministic, checkpointed atomically or idempotent, rebuildable side by side, and monitored for lag.
- [ ] There are no dual writes (only an outbox or event-store subscriptions), and every consumer deduplicates.
- [ ] Ordering is assumed only per aggregate key, and handlers detect gaps.
- [ ] Every historical event version has an upcaster fixture test.
- [ ] Snapshots are versioned and disposable.
- [ ] Personal data stays out of events or is crypto-shredded, and the erasure path covers read models, topics and backups.
- [ ] The UX handles eventual consistency with command results, read-your-writes or pending states.

<!-- Written for legacies (MIT). Checked against: https://martendb.io/events/projections/, https://martendb.io/events/projections/async-daemon, https://martendb.io/events/versioning.html, https://apidocs.axoniq.io/4.6/org/axonframework/eventhandling/GapAwareTrackingToken.html, https://docs.axoniq.io/axon-framework-reference/4.12/events/event-versioning, https://docs.kurrent.io/server/v25.0/quick-start/upgrade-guide, https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html, https://kafka.apache.org/41/design/design/, https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html, https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions, https://www.rabbitmq.com/docs/consumers#single-active-consumer, https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html, 2026-10 -->
