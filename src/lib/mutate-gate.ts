/** Generation token for overlapping mutate apply/rollback. */
export type MutateGate = { latest: number };

export function beginMutate(gate: MutateGate): number {
  gate.latest += 1;
  return gate.latest;
}

/** True when this mutate still owns applyMutationResult / rollback. */
export function canCommitMutate(gate: MutateGate, token: number): boolean {
  return gate.latest === token;
}
