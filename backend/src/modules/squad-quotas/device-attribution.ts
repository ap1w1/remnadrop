import { isIP } from 'node:net';
export function normalizeDeviceIp(value: string | null): string | null {
    if (!value) return null;
    let ip=value.trim();
    if (ip.startsWith('::ffff:') && isIP(ip.slice(7))===4) ip=ip.slice(7);
    if (isIP(ip)===4) return ip;
    if (isIP(ip)===6) return new URL(`http://[${ip}]/`).hostname;
    return null;
}
export function attributeDevice(ip: string, devices: {hwid:string;platform:string|null;deviceModel:string|null;userAgent:string|null;requestIp:string|null;createdAt:Date;updatedAt:Date}[], at: Date) {
    const normalized=normalizeDeviceIp(ip);
    // A subscription can go unrefreshed for days. Keep the match tentative and
    // require the device to have existed when the torrent event occurred.
    const candidates=devices.filter(d=>normalized!==null && normalizeDeviceIp(d.requestIp)===normalized && d.createdAt.getTime()<=at.getTime() && d.updatedAt.getTime()>=at.getTime()-30*86400000 && d.updatedAt.getTime()<=at.getTime()+300000);
    if (candidates.length!==1) return {device:null,deviceIdentification:{status:'unknown' as const,method:'ip' as const,candidateCount:candidates.length}};
    const d=candidates[0];
    return {device:{hwid:d.hwid,platform:d.platform,model:d.deviceModel,userAgent:d.userAgent},deviceIdentification:{status:'probable' as const,method:'ip' as const,candidateCount:1}};
}
