import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { idKey, Replica, type Op } from "../src/index.js";

const RUNS = 1000; // random schedules per property

type Action =
  | { kind: "insert"; r: number; at: number; text: string }
  | { kind: "delete"; r: number; at: number; len: number }
  | { kind: "deliver"; r: number; pick: number };

const chars = fc.constantFrom("a", "b", "c", "x", "y", " ", "é", "😀");
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    r: fc.nat(),
    at: fc.double({ min: 0, max: 1, noNaN: true }),
    text: fc.array(chars, { minLength: 1, maxLength: 3 }).map((a) => a.join("")),
  }),
  fc.record({
    kind: fc.constant("delete" as const),
    r: fc.nat(),
    at: fc.double({ min: 0, max: 1, noNaN: true }),
    len: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({ kind: fc.constant("deliver" as const), r: fc.nat(), pick: fc.nat() }),
);

/** Runs a random multi-replica session over a network that reorders and duplicates messages. */
function simulate(replicaCount: number, actions: readonly Action[]) {
  const replicas = Array.from({ length: replicaCount }, (_, i) => new Replica(`r${i}`));
  const inboxes: Op[][] = replicas.map(() => []);
  const all: Op[] = [];
  const send = (from: number, ops: readonly Op[]) => {
    all.push(...ops);
    inboxes.forEach((inbox, to) => to !== from && inbox.push(...ops));
  };
  for (const a of actions) {
    const r = a.r % replicaCount;
    const rep = replicas[r] as Replica;
    if (a.kind === "insert") {
      send(r, rep.insert(Math.floor(a.at * (rep.length + 1)) % (rep.length + 1), a.text));
    } else if (a.kind === "delete" && rep.length > 0) {
      const start = Math.floor(a.at * rep.length) % rep.length;
      send(r, rep.delete(start, Math.min(a.len, rep.length - start)));
    } else if (a.kind === "deliver") {
      const inbox = inboxes[r] as Op[];
      if (inbox.length > 0) rep.apply(inbox.splice(a.pick % inbox.length, 1)[0]); // any order, not causal
    }
  }
  // Flush every inbox backwards (the most out-of-order delivery), then deliver everything again.
  replicas.forEach((rep, r) => {
    for (const op of (inboxes[r] as Op[]).reverse()) rep.apply(op);
    for (const op of all) rep.apply(op);
  });
  return { replicas, all };
}

test("all replicas converge to the same text, whatever the delivery order", () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 4 }), fc.array(action, { maxLength: 60 }), (n, actions) => {
      const { replicas } = simulate(n, actions);
      const text = replicas[0]?.toString();
      for (const rep of replicas) {
        assert.equal(rep.pendingCount, 0);
        assert.equal(rep.toString(), text);
      }
    }),
    { numRuns: RUNS },
  );
});

test("no edit is lost and no deleted character comes back", () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 4 }), fc.array(action, { maxLength: 60 }), (n, actions) => {
      const { replicas, all } = simulate(n, actions);
      const deleted = new Set(all.flatMap((op) => (op.type === "delete" ? [idKey(op.target)] : [])));
      const survivors = all.flatMap((op) => (op.type === "insert" && !deleted.has(idKey(op.id)) ? [op.value] : []));
      const visible = [...(replicas[0]?.toString() ?? "")];
      assert.deepEqual([...visible].sort(), [...survivors].sort());
    }),
    { numRuns: RUNS },
  );
});

test("a single replica behaves exactly like a plain string", () => {
  fc.assert(
    fc.property(fc.array(action, { maxLength: 60 }), (actions) => {
      const rep = new Replica("solo");
      let model: string[] = [];
      for (const a of actions) {
        if (a.kind === "insert") {
          const at = Math.floor(a.at * (model.length + 1)) % (model.length + 1);
          rep.insert(at, a.text);
          model = [...model.slice(0, at), ...a.text, ...model.slice(at)];
        } else if (a.kind === "delete" && model.length > 0) {
          const start = Math.floor(a.at * model.length) % model.length;
          const len = Math.min(a.len, model.length - start);
          rep.delete(start, len);
          model.splice(start, len);
        }
      }
      assert.equal(rep.toString(), model.join(""));
    }),
    { numRuns: RUNS },
  );
});
