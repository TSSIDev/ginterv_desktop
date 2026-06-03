# Write-queue offline + optimistic write + conflict handling — Design

Date: 2026-06-03
Status: Approved (design)

## Goal

Make intervention writes (create/update/delete) seamless and offline-capable:

- The change applies to the local cache/UI **immediately** (optimistic), with no
  blocking spinner; the write goes to Exchange in the background.
- Operations are persisted in a durable queue so they survive offline periods
  and app restarts, and are flushed automatically when connectivity returns.
- Conflicts (the item changed on the server since the local edit was based on it)
  are **detected and surfaced to the user**, never silently overwritten. Today
  `update_item` uses `ConflictResolution="AlwaysOverwrite"`, which can silently
  clobber newer server changes — this design removes that risk.

Decisions taken during brainstorming:
- **Conflict policy:** detect and ask the user (keep mine / keep server), with a
  small field-level diff to inform the choice.
- **Offline scope:** full offline — persistent queue, creates use a temporary
  local id reconciled to the real Exchange id at flush time.
- **Approach:** unified queue — every write is optimistic and goes through the
  queue; online simply flushes immediately.

## 1. Data model

### New table `pending_ops`

Durable, ordered queue. One row per pending write.

| column            | type    | notes |
|-------------------|---------|-------|
| `id`              | INTEGER PK AUTOINCREMENT | queue order |
| `user_email`      | TEXT    | account |
| `op_type`         | TEXT    | `create` \| `update` \| `delete` |
| `local_id`        | TEXT    | client UUID; optimistic cache key for creates |
| `exchange_item_id`| TEXT NULL | real id; NULL until a create is flushed |
| `base_change_key` | TEXT NULL | change_key the edit/delete was based on (conflict detection) |
| `payload`         | TEXT NULL | JSON of `InterventionData` (create/update; NULL for delete) |
| `status`          | TEXT    | `pending` \| `conflict` \| `error` |
| `attempts`        | INTEGER | retry counter |
| `last_error`      | TEXT NULL | last failure message |
| `created_at`      | TEXT    | rfc3339 |
| `updated_at`      | TEXT    | rfc3339 |

### Cache table `intervention_cache`

Add column `pending_op TEXT NULL` (`create`/`update`/`delete`) via migration.

- Offline creates are stored with `exchange_item_id = "tmp-<uuid>"` (the
  `local_id`). At flush the row is migrated to the real Exchange id.
- `get_range` hides tombstones (`pending_op = 'delete'`) from the list/calendar.
- A row with any non-null `pending_op` renders an "in attesa di sync" badge.

## 2. Components

- **`db/queue.rs`** (new): `enqueue`, `list_pending(user)`, `next_pending(user)`,
  `mark_conflict`, `mark_error`, `delete_op`, `get_op`.
- **`db/cache.rs`**: `pending_op` column + migration; `mark_pending`,
  `reconcile_create(local_id → real_id, change_key)` which also migrates the
  `signatures` row keyed on the temp id to the real id; `get_range` filters
  tombstones; existing `upsert_item` / `upsert_item_metadata` reused.
- **Write commands (`commands/interventions.rs`)** rewritten to be optimistic:
  apply to cache, enqueue, spawn a non-blocking flush, return the optimistic item.
- **`flush.rs`** (new): `flush_pending(client, email, state, handle)` processes
  the queue FIFO, serialized per account (writes must keep order).
- **Conflict commands**: `flush_queue(email)` (manual/connectivity trigger),
  `list_conflicts(email)`, `resolve_conflict(op_id, choice)`.

## 3. Flush flow (per operation, FIFO)

- **create** → `CreateItem` → on success `reconcile_create` (temp id → real id in
  cache + signatures; clear `pending_op`; delete op). Network error → leave
  queued, `attempts++`, stop and retry on next trigger.
- **update / delete** → `GetItem` to read the current server `change_key`.
  - server `change_key` == `base_change_key` → no conflict → `UpdateItem` /
    `DeleteItem` with the fresh change_key → reconcile cache → delete op.
  - server `change_key` != `base_change_key` → **conflict**: `mark_conflict`,
    emit `write-conflict`, skip this op (do not block subsequent ops for other
    items; the conflicted op waits for user resolution).

Conflict decision is extracted as a pure function
`is_conflict(base_change_key, server_change_key) -> bool` for unit testing.

Flush triggers: after each optimistic write (spawned), on `online`/focus from the
frontend (`flush_queue`), and within the existing sync loop.

## 4. Conflicts — detection, diff, resolution

When a conflict is detected the op is marked `conflict` and a `write-conflict`
event is emitted. The resolver UI shows a **compact field-level delta**: for the
affected intervention it fetches the current server version (`GetItem`) and
compares it against the local pending version, listing **only the fields that
differ** (e.g. `Inizio`, `Descrizione`, `Note`), side by side: *mia* vs *server*.

Choices:
- **Tieni le mie modifiche** → rebase the op onto the current server change_key
  and re-issue `UpdateItem` (force) → reconcile cache → delete op.
- **Tieni versione server** → discard the op, write the server version into the
  cache (clear `pending_op`) → delete op.

Never silently overwrite.

## 5. Frontend

- `submitForm` / `confirmDelete` get an instant optimistic return; the item shows
  an "in attesa di sync" badge while `pending_op` is set. No blocking spinner.
- **Save-and-sign offline:** signatures are stored in the local DB keyed by
  item id, so signing a temp-id item works offline; `reconcile_create` migrates
  the signature to the real id at flush. Email/PDF stay online-only (need SMTP).
- Listener `write-conflict` → badge + resolver modal with the field delta.
  `sync-complete` already refreshes the list after flush.
- `flush_queue` invoked on `online`/focus (extends `maybeSyncOnFocus`).

## 6. Error handling

- Network absent → ops persisted, retried on next trigger; zero data loss.
- Conflict → never silent; always surfaced with a diff and an explicit choice.
- Repeated hard errors → `status = 'error'` after 5 attempts, surfaced to the
  user (badge + entry in the conflicts/queue view) with `last_error`.

## 7. Testing

Unit-testable:
- `db/queue.rs`: enqueue / list / next / reconcile / mark_conflict / mark_error / delete.
- `db/cache.rs`: `pending_op` migration, tombstone hidden in `get_range`,
  `reconcile_create` migrates both cache id and signature id.
- `is_conflict` pure function (base vs server change_key).
- SOAP builders already covered.

Manual (no live Exchange in tests): end-to-end flush, conflict modal + diff,
offline create → reconcile, save-and-sign offline.

## 8. Out of scope

- EWS `SyncFolderItems` true delta (#3) and Streaming Notifications (#6) remain
  separate backlog items.
- Multi-field 3-way auto-merge: we offer whole-item keep-mine / keep-server only,
  with a diff to inform the choice (no per-field merge in v1).
