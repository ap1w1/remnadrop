export interface MonitoringRule {
    enabled:boolean; onlineDropPercent:number|null; trafficDropPercent:number|null;
    cpuPercent:number|null; memoryPercent:number|null; baselineMinutes:number;
    consecutiveSamples:number; minOnline:number; minTraffic:number;
}
export const defaultMonitoringRule:MonitoringRule={enabled:false,onlineDropPercent:30,trafficDropPercent:50,cpuPercent:90,memoryPercent:90,baselineMinutes:10,consecutiveSamples:2,minOnline:5,minTraffic:1024};
export function validateMonitoringRule(value:unknown):MonitoringRule {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid settings');
    const v=value as Record<string,unknown>;
    if (typeof v.enabled!=='boolean') throw new Error('enabled must be boolean');
    const out={enabled:v.enabled} as MonitoringRule;
    for(const key of ['onlineDropPercent','trafficDropPercent','cpuPercent','memoryPercent'] as const){
        const n=v[key];if(n!==null && (typeof n!=='number'||!Number.isFinite(n)||n<=0||n>100))throw new Error(`${key}: expected null or 0 < percent <= 100`);out[key]=n as number|null;
    }
    for(const [key,min,max] of [['baselineMinutes',3,60],['consecutiveSamples',1,10],['minOnline',1,10000000],['minTraffic',1,1000000000000]] as const){
        const n=v[key];if(typeof n!=='number'||!Number.isInteger(n)||n<min||n>max)throw new Error(`${key}: invalid range`);out[key]=n;
    }
    return out;
}
export function dropPercent(current:number|null,baseline:number|null,minimum:number):number|null {
    return current===null||baseline===null||baseline<minimum?null:Math.max(0,(baseline-current)/baseline*100);
}
