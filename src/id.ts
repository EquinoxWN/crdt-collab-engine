/** A character's identity: which replica created it and that replica's Lamport counter at the time. */
export interface Id {
  readonly replica: string;
  readonly counter: number;
}

/** Total order on ids: higher counter first decides, replica name breaks ties. */
export function compareIds(a: Id, b: Id): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.replica === b.replica) return 0;
  return a.replica < b.replica ? -1 : 1;
}

/** Map key for an id. */
export function idKey(id: Id): string {
  return `${id.counter}@${id.replica}`;
}
