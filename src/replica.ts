import { compareIds, idKey, type Id } from "./id.js";
import { assertId, assertOp, type DeleteOp, type InsertOp, type Op } from "./ops.js";

interface Item {
  readonly id: Id;
  readonly value: string;
  deleted: boolean;
}

export interface ReplicaOptions {
  /** Most operations held while waiting for the ones they depend on. */
  readonly maxPending?: number;
}

/**
 * One copy of a shared text document (an RGA-style sequence CRDT).
 * Every character has a unique id and remembers its left neighbour at insert time; deletes leave
 * tombstones, so concurrent operations that refer to a deleted character still resolve.
 */
export class Replica {
  readonly name: string;
  readonly #maxPending: number;
  #clock = 0;
  readonly #items: Item[] = [];
  readonly #byKey = new Map<string, Item>();
  readonly #pending: Op[] = [];

  constructor(name: string, options: ReplicaOptions = {}) {
    assertId({ replica: name, counter: 1 }, "replica name");
    this.name = name;
    this.#maxPending = options.maxPending ?? 100_000;
  }

  /** The visible text. */
  toString(): string {
    let out = "";
    for (const item of this.#items) if (!item.deleted) out += item.value;
    return out;
  }

  /** Number of visible characters. */
  get length(): number {
    let n = 0;
    for (const item of this.#items) if (!item.deleted) n++;
    return n;
  }

  /** Operations received but waiting for an operation they depend on. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Inserts text before visible position index; returns the operations to send to peers. */
  insert(index: number, text: string): InsertOp[] {
    if (!Number.isInteger(index) || index < 0 || index > this.length) throw new RangeError("index out of range");
    let origin: Id | null = index === 0 ? null : this.#visible(index - 1).id;
    const ops: InsertOp[] = [];
    for (const value of text) {
      const op: InsertOp = { type: "insert", id: { replica: this.name, counter: this.#clock + 1 }, origin, value };
      this.#integrate(op);
      ops.push(op);
      origin = op.id;
    }
    return ops;
  }

  /** Deletes count visible characters starting at index; returns the operations to send to peers. */
  delete(index: number, count: number): DeleteOp[] {
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || count < 0 || index + count > this.length) {
      throw new RangeError("range out of bounds");
    }
    const ops: DeleteOp[] = [];
    for (let i = 0; i < count; i++) ops.push({ type: "delete", target: this.#visible(index + i).id });
    for (const op of ops) this.#tombstone(op);
    return ops;
  }

  /** Applies an operation from a peer, in any order and any number of times. */
  apply(op: unknown): void {
    assertOp(op);
    if (this.#pending.length >= this.#maxPending) throw new RangeError("too many pending operations");
    this.#pending.push(op);
    this.#drain();
  }

  /** The visible item at position index. */
  #visible(index: number): Item {
    let seen = 0;
    for (const item of this.#items) {
      if (item.deleted) continue;
      if (seen === index) return item;
      seen++;
    }
    throw new RangeError("index out of range");
  }

  /** Applies every pending operation whose dependency is present, until none is left. */
  #drain(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < this.#pending.length; ) {
        const op = this.#pending[i] as Op;
        const ready =
          op.type === "insert" ? op.origin === null || this.#byKey.has(idKey(op.origin)) : this.#byKey.has(idKey(op.target));
        if (!ready) {
          i++;
          continue;
        }
        this.#pending.splice(i, 1);
        if (op.type === "insert") this.#integrate(op);
        else this.#tombstone(op);
        progress = true;
      }
    }
  }

  /** Places an insert after its origin, skipping concurrent inserts with a higher id (RGA rule). */
  #integrate(op: InsertOp): void {
    const key = idKey(op.id);
    if (this.#byKey.has(key)) return; // duplicate delivery
    this.#clock = Math.max(this.#clock, op.id.counter);
    let pos = 0;
    if (op.origin !== null) pos = this.#items.indexOf(this.#byKey.get(idKey(op.origin)) as Item) + 1;
    // Items between the origin and pos with a higher id were inserted concurrently (or later) and win.
    while (pos < this.#items.length && compareIds((this.#items[pos] as Item).id, op.id) > 0) pos++;
    const item: Item = { id: op.id, value: op.value, deleted: false };
    this.#items.splice(pos, 0, item);
    this.#byKey.set(key, item);
  }

  /** Marks the target as deleted; deleting twice is harmless. */
  #tombstone(op: DeleteOp): void {
    const item = this.#byKey.get(idKey(op.target));
    if (item) item.deleted = true;
  }
}
