# ADR 0002: Order concurrent inserts with the RGA rule first, move to Fugue in M2

- **Status:** Accepted

## Context

When two replicas insert at the same place concurrently, every replica must put the new characters
in the same order, or the documents diverge. Several published rules do this. RGA (replicated
growable array) is simple: after the origin, skip every character with a higher id. Fugue (2023)
also converges and additionally prevents interleaving, where two concurrently inserted runs get
mixed together character by character (RGA shows this for text inserted right-to-left), but it is
more complex and needs both a left and a right origin.

## Decision

M1 uses the RGA rule with Lamport-clock ids. It is short enough to review line by line, and the
fast-check properties prove convergence for it. M2 replaces it with Fugue behind the same
operation and replica API, and adds tests that demonstrate the interleaving difference.

## Consequences

- M1 converges and never loses an edit, but text inserted right-to-left concurrently at the same
  spot can interleave. The README and RFC say so.
- The property tests are written against the public API, so they apply unchanged to Fugue; a
  mutation check already shows they fail when the ordering rule is broken.
- Operations will gain a right origin in M2, a format change made before any data exists.
