import assert from "node:assert/strict";
import { test } from "node:test";
import { Replica, type Op } from "../src/index.js";

/** Sends every op to each peer. */
function broadcast(ops: readonly Op[], ...peers: Replica[]): void {
  for (const peer of peers) for (const op of ops) peer.apply(op);
}

test("local inserts and deletes behave like a string", () => {
  const a = new Replica("a");
  a.insert(0, "helo");
  a.insert(3, "l");
  a.insert(5, " world");
  a.delete(0, 1);
  a.insert(0, "H");
  assert.equal(a.toString(), "Hello world");
  assert.equal(a.length, 11);
});

test("characters are code points, so emoji are never split", () => {
  const a = new Replica("a");
  a.insert(0, "a😀b");
  assert.equal(a.length, 3);
  a.delete(1, 1);
  assert.equal(a.toString(), "ab");
});

test("every character gets a unique id from its replica and Lamport counter", () => {
  const a = new Replica("a");
  const ops = a.insert(0, "abc");
  assert.deepEqual(
    ops.map((op) => op.id),
    [
      { replica: "a", counter: 1 },
      { replica: "a", counter: 2 },
      { replica: "a", counter: 3 },
    ],
  );
  assert.equal(ops[0]?.origin, null);
  assert.deepEqual(ops[1]?.origin, ops[0]?.id);
});

test("receiving an op advances the Lamport clock past it", () => {
  const a = new Replica("a");
  const b = new Replica("b");
  broadcast(a.insert(0, "xyz"), b);
  const [op] = b.insert(3, "!");
  assert.equal(op?.id.counter, 4);
});

test("concurrent inserts at the same spot end in the same order everywhere", () => {
  const a = new Replica("a");
  const b = new Replica("b");
  broadcast(a.insert(0, "[]"), b);
  const fromA = a.insert(1, "A");
  const fromB = b.insert(1, "B");
  broadcast(fromB, a);
  broadcast(fromA, b);
  assert.equal(a.toString(), b.toString());
  assert.match(a.toString(), /^\[(AB|BA)\]$/);
});

test("an insert next to a concurrently deleted character still lands in the right place", () => {
  const a = new Replica("a");
  const b = new Replica("b");
  broadcast(a.insert(0, "abc"), b);
  const del = a.delete(1, 1); // a removes "b"
  const ins = b.insert(2, "X"); // b types after "b"
  broadcast(ins, a);
  broadcast(del, b);
  assert.equal(a.toString(), "aXc");
  assert.equal(b.toString(), "aXc");
});

test("ops that arrive before their dependency wait, then apply", () => {
  const a = new Replica("a");
  const b = new Replica("b");
  const first = a.insert(0, "ab");
  const del = a.delete(0, 1);
  for (const op of [...del, ...first].reverse()) b.apply(op); // worst possible order
  assert.equal(b.pendingCount, 0);
  assert.equal(b.toString(), "b");

  const c = new Replica("c");
  c.apply(first[1]);
  assert.equal(c.pendingCount, 1);
  assert.equal(c.toString(), "");
  c.apply(first[0]);
  assert.equal(c.pendingCount, 0);
  assert.equal(c.toString(), "ab");
});

test("applying the same op twice changes nothing", () => {
  const a = new Replica("a");
  const b = new Replica("b");
  const ops = [...a.insert(0, "hi"), ...a.delete(0, 1)];
  broadcast(ops, b);
  broadcast(ops, b);
  assert.equal(b.toString(), "i");
});

test("malformed ops from a peer are rejected without changing the document", () => {
  const b = new Replica("b");
  b.insert(0, "ok");
  const bad: unknown[] = [
    null,
    "insert",
    { type: "move" },
    { type: "insert", id: { replica: "a", counter: 0 }, origin: null, value: "x" },
    { type: "insert", id: { replica: "", counter: 1 }, origin: null, value: "x" },
    { type: "insert", id: { replica: "a", counter: 1.5 }, origin: null, value: "x" },
    { type: "insert", id: { replica: "a", counter: 1 }, origin: null, value: "xy" },
    { type: "insert", id: { replica: "a", counter: 1 }, origin: null, value: "" },
    { type: "insert", id: { replica: "a".repeat(65), counter: 1 }, origin: null, value: "x" },
    { type: "delete", target: { replica: "a" } },
  ];
  for (const op of bad) assert.throws(() => b.apply(op), TypeError, JSON.stringify(op));
  assert.equal(b.toString(), "ok");
  assert.equal(b.pendingCount, 0);
});

test("a peer cannot grow the pending buffer without limit", () => {
  const b = new Replica("b", { maxPending: 3 });
  const orphan = (n: number): Op => ({
    type: "insert",
    id: { replica: "a", counter: n + 10 },
    origin: { replica: "ghost", counter: 1 },
    value: "x",
  });
  for (let n = 0; n < 3; n++) b.apply(orphan(n));
  assert.throws(() => b.apply(orphan(3)), RangeError);
});

test("local edits outside the document are refused", () => {
  const a = new Replica("a");
  a.insert(0, "abc");
  assert.throws(() => a.insert(4, "x"), RangeError);
  assert.throws(() => a.insert(-1, "x"), RangeError);
  assert.throws(() => a.delete(2, 2), RangeError);
  assert.throws(() => new Replica(""), TypeError);
});

/** Two replicas type two characters each at the start, forwards or backwards, then sync. */
function typeConcurrently(backwards: boolean): string[] {
  const a = new Replica("a");
  const b = new Replica("b");
  const typed = (rep: Replica, text: string) =>
    backwards ? [...text].reverse().flatMap((ch) => rep.insert(0, ch)) : rep.insert(0, text);
  const fromA = typed(a, "ab");
  const fromB = typed(b, "xy");
  broadcast(fromB, a);
  broadcast(fromA, b);
  return [a.toString(), b.toString()];
}

test("text typed forwards concurrently at the same spot stays together", () => {
  assert.deepEqual(typeConcurrently(false), ["xyab", "xyab"]);
});

test("known limitation, fixed by Fugue in M2: text typed backwards concurrently interleaves", () => {
  assert.deepEqual(typeConcurrently(true), ["xayb", "xayb"]);
});
