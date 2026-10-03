import type { Id } from "./id.js";

/** Insert one character to the right of `origin` (null means the start of the document). */
export interface InsertOp {
  readonly type: "insert";
  readonly id: Id;
  readonly origin: Id | null;
  readonly value: string;
}

/** Turn the character `target` into a tombstone. */
export interface DeleteOp {
  readonly type: "delete";
  readonly target: Id;
}

export type Op = InsertOp | DeleteOp;

const MAX_REPLICA_NAME = 64;

/** Throws TypeError unless value is a well-formed operation (ops arrive from untrusted peers). */
export function assertOp(value: unknown): asserts value is Op {
  if (typeof value !== "object" || value === null) throw new TypeError("invalid op: not an object");
  const op = value as Record<string, unknown>;
  if (op.type === "insert") {
    assertId(op.id, "id");
    if (op.origin !== null) assertId(op.origin, "origin");
    if (typeof op.value !== "string" || [...op.value].length !== 1) {
      throw new TypeError("invalid op: value must be exactly one character");
    }
  } else if (op.type === "delete") {
    assertId(op.target, "target");
  } else {
    throw new TypeError("invalid op: unknown type");
  }
}

/** Throws TypeError unless value is a valid id. */
export function assertId(value: unknown, field: string): asserts value is Id {
  const id = value as Partial<Id> | null;
  if (
    typeof id !== "object" ||
    id === null ||
    typeof id.replica !== "string" ||
    id.replica.length === 0 ||
    id.replica.length > MAX_REPLICA_NAME ||
    !Number.isSafeInteger(id.counter) ||
    (id.counter as number) < 1
  ) {
    throw new TypeError(`invalid op: bad ${field}`);
  }
}
