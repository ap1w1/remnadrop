export interface SquadQuotaState {
    limitBytes: bigint | null;
    usedBytes: bigint;
    blockedByQuota: boolean;
}

/** Pure policy; persistence and access reconciliation must run transactionally. */
export function applyQuotaUsage(state: SquadQuotaState, delta: bigint): SquadQuotaState {
    if (delta < 0n || state.usedBytes < 0n || (state.limitBytes !== null && state.limitBytes < 0n)) {
        throw new RangeError('Traffic values must be non-negative');
    }
    const usedBytes = state.usedBytes + delta;
    return {
        ...state,
        usedBytes,
        blockedByQuota: state.limitBytes !== null && usedBytes >= state.limitBytes,
    };
}

/** Node-wide counters cannot distinguish multiple accessible squads on one node. */
export function requireUnambiguousSquad(squadUuids: string[]): string {
    const unique = [...new Set(squadUuids)];
    if (unique.length !== 1) throw new Error('AMBIGUOUS_NODE_SQUAD_USAGE');
    return unique[0];
}
