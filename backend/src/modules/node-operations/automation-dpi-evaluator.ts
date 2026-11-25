/**
 * Classify completed DPI Checker jobs by DISTINCT measured geographic regions.
 * Unknown / malformed evidence must never cause an IP rotation.
 * Results are considered evidence only when their PoP can be matched to the
 * exact PoP list requested for that check. No inference from HTTP errors.
 */
export type DpiVerdict = 'unavailable' | 'available' | 'unknown';
export type DpiProbe = { connected?: unknown; pop_id?: unknown; popId?: unknown; pop_name?: unknown; host?: unknown };
export type DpiCheckEvidence = {
    location: string;
    status: string;
    pop_ids: number[];
    popRegions: Record<string, string>;
    popNames: Record<string, string>;
    results: unknown;
    hostCount: number;
};
export type DpiDecision = {
    outcome: DpiVerdict; unavailableRegions: number; availableRegions: number;
    unknownRegions: number; totalRegions: number; details: string[];
};
export function evaluateDpiRegions(checks: DpiCheckEvidence[], threshold: number): DpiDecision {
    const regionPops = new Map<string, Set<number>>();
    const byRegion = new Map<string, Map<number, boolean[]>>();
    const unknown = new Set<string>();
    const details: string[] = [];
    if (!Number.isInteger(threshold) || threshold < 1 || !checks.length) {
        return {outcome:'unknown',unavailableRegions:0,availableRegions:0,unknownRegions:0,totalRegions:0,details:['Invalid region threshold']};
    }
    for (const check of checks) {
        if (!Array.isArray(check.pop_ids) || !check.pop_ids.length || check.status !== 'completed' || !Array.isArray(check.results)) {
            unknown.add(check.location + ':incomplete');
            details.push(check.location + ': DPI check incomplete or failed');
            continue;
        }
        const allowed = new Set(check.pop_ids);
        const nameLookup = new Map<string, number>();
        for (const [key,name] of Object.entries(check.popNames)) {
            const id = Number(key);
            if (allowed.has(id) && name) nameLookup.set(name.trim().toLocaleLowerCase(), id);
        }
        for (const popId of check.pop_ids) {
            const region = check.popRegions[String(popId)]?.trim();
            if (!region) { unknown.add(check.location + ':unknown-pop-' + popId); continue; }
            const key = check.location + ':' + region.toLocaleLowerCase();
            if (!regionPops.has(key)) regionPops.set(key,new Set());
            regionPops.get(key)!.add(popId);
            if (!byRegion.has(key)) byRegion.set(key,new Map());
        }
        for (const raw of check.results) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const probe = raw as DpiProbe;
            if (typeof probe.connected !== 'boolean') continue;
            let pop = Number(probe.pop_id ?? probe.popId);
            if (!Number.isSafeInteger(pop) || !allowed.has(pop)) {
                const name = typeof probe.pop_name === 'string' ? probe.pop_name.trim().toLocaleLowerCase() : '';
                pop = nameLookup.get(name) ?? -1;
            }
            // The result must identify a measured region unambiguously.
            if (!allowed.has(pop)) continue;
            const region = check.popRegions[String(pop)]?.trim();
            if (!region) continue;
            const key = check.location + ':' + region.toLocaleLowerCase();
            const grouped = byRegion.get(key);
            if (!grouped) continue;
            grouped.set(pop, [...(grouped.get(pop) ?? []), probe.connected]);
        }
        for (const pop of check.pop_ids) {
            const region = check.popRegions[String(pop)]?.trim();
            if (!region) continue;
            const key = check.location + ':' + region.toLocaleLowerCase();
            if ((byRegion.get(key)?.get(pop)?.length ?? 0) < check.hostCount) unknown.add(key);
        }
    }
    let unavailableRegions=0,availableRegions=0,unknownRegions=unknown.size;
    for (const [key,pops] of regionPops) {
        let isAvailable = false, isUnavailable = true, enoughEvidence = true;
        for (const pop of pops) {
            const results = byRegion.get(key)?.get(pop) ?? [];
            if (!results.length) enoughEvidence = false;
            if (results.some(connected => connected)) isAvailable = true;
            if (results.some(connected => connected) || !results.length) isUnavailable = false;
        }
        if (isAvailable) { availableRegions++; details.push(key + ': accessible'); }
        else if (enoughEvidence && isUnavailable && !unknown.has(key)) { unavailableRegions++; details.push(key + ': unreachable'); }
        else { if (!unknown.has(key)) unknownRegions++; details.push(key + ': inconclusive'); }
    }
    const outcome: DpiVerdict = unavailableRegions >= threshold ? 'unavailable' :
        unknownRegions > 0 || !regionPops.size ? 'unknown' : 'available';
    return {outcome,unavailableRegions,availableRegions,unknownRegions,totalRegions:regionPops.size,details};
}
