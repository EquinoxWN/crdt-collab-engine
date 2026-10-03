# RFC 0001: crdt-collab-engine design

- **Status:** Accepted (M1 implemented)
- **Author:** EquinoxWN
- **Created:** 2026

## Problem

When several people edit the same document at once, and some of them are offline, their edits
reach each other in different orders. Positions by index break immediately: "insert at 5" means
something different once a peer has deleted character 2. Locking or a central server that
serialises every keystroke fails offline. A conflict-free replicated data type (CRDT) lets every
replica apply operations in any order and still end with the same text, without losing an edit.

## Goals

- Every character has a unique, immutable id `(replica, counter)`, where the counter is a Lamport
  clock, so a position is expressed by identity rather than by index.
- An insert records the id of its left neighbour (its origin); a deterministic rule orders
  concurrent inserts after the same origin.
- Deletes turn characters into tombstones, so concurrent inserts that refer to them still resolve.
- Operations may arrive in any order and more than once; the replica buffers an operation until
  the one it depends on has arrived.
- Operations from peers are untrusted: malformed operations are rejected and the waiting buffer is
  bounded.
- Later: Fugue ordering against interleaving (M2), state-vector sync and run-length binary
  encoding (M2), tombstone garbage collection and benchmarks against Yjs and Automerge (M3).

## Non-goals

- Rich text and formatting marks (roadmap).
- A network transport. Tests simulate one that reorders and duplicates messages.
- Running as a hosted production service.

## Proposed design

![architecture](../architecture.png)

```
local edit ──► Replica.insert / delete ──► ops ──► (any transport: reorders, duplicates) ──► Replica.apply
                     │                                                                        │
                     └──────── integrate: place after origin, skip higher ids (RGA) ◄─────────┘
                                                      ▲
                                pending buffer (waits for missing origin or target, bounded)
```

| Concept | M1 implementation |
|---|---|
| Id | `{ replica, counter }`; counter = Lamport clock, advanced past every id received |
| Order | Compare counter, then replica name: a total order known to every replica |
| Insert op | `{ type: "insert", id, origin, value }`, one Unicode code point per op |
| Delete op | `{ type: "delete", target }`; idempotent |
| Integration | Start right after the origin and skip items with a higher id (RGA rule, ADR 0002) |
| Causality | Ops whose origin or target is unknown wait in a bounded pending buffer |
| Duplicates | An insert whose id is already known is ignored |

Lamport counters guarantee that anything inserted after a character (and so to its right in its
subtree) has a higher id than that character, which is what makes the skip rule converge.

## Alternatives considered

| Option | Why not (yet) |
|---|---|
| Operational transformation (Google Docs' original approach) | Needs a central server to order operations, and transformation functions are notoriously hard to get right; offline editing is the weak spot. |
| Logoot / LSEQ (dense position identifiers) | No tombstones, but identifiers grow without bound under concurrent editing and still interleave. |
| Fugue from day one | Avoids interleaving, but is more complex. RGA first gives a tested baseline to measure Fugue against (ADR 0002). |
| Require causal delivery from the transport | Simpler replica, but every transport would need it; buffering inside the replica makes any transport safe. |
| Use Yjs or Automerge directly | Production-grade, but the point is to build and prove the algorithm; they are the M3 benchmark baseline. |

## Measurement plan

- M1: unit tests for every rule and three fast-check properties over 1,000 random multi-replica
  schedules each (convergence, no lost or resurrected edits, single-replica string equivalence).
  A mutation check confirms the properties fail when the ordering rule is broken.
- M2: interleaving tests and property runs into the millions.
- M3: memory, update size and apply time against Yjs and Automerge on a real editing trace.

## Milestones

- **M1 (done):** ids, Lamport clocks, RGA integration, tombstones, causal buffering, input
  validation, property tests.
- **M2:** Fugue ordering, state vectors and delta sync, run-length binary encoding.
- **M3:** tombstone garbage collection, benchmarks, two-pane browser demo.

## Risks and open questions

- RGA keeps text typed forwards together, but text inserted right-to-left (or with the cursor
  moved back between keystrokes) concurrently at the same spot can interleave character by
  character. Convergence still holds; Fugue in M2 fixes it, and M2 adds tests that show the
  difference.
- Tombstones and per-character items make memory grow with every edit. Run-length items and
  garbage collection are M2 and M3 work.
- Locating an item is linear in document size; fine for M1, measured in M3.
