/** Keep measurement evidence, NEVER persist provider-returned subscription credentials. */
const forbiddenKey=/(?:^|_)(?:uri|key|keys|secret|password|passwd|token|authorization|credential|subscription|proxyconfig|privatekey|accesskey)(?:$|_)/i;
const linkPattern=/(?:vless|vmess|trojan|ss|hysteria|hysteria2|socks5?):\/\//i;
export function safeDpiResponse(raw:unknown):Record<string,unknown> {
    const seen=new WeakSet<object>();
    let count=0;
    const sanitize=(value:unknown,depth:number):unknown=>{
        if(depth>12 || ++count>100000)return '[truncated for safety]';
        if(value===null || typeof value==='number' || typeof value==='boolean')return value;
        if(typeof value==='string'){
            if(linkPattern.test(value))return '[connection credential redacted]';
            if(value.length>10000)return value.slice(0,10000)+'…';
            return value;
        }
        if(!value || typeof value!=='object')return null;
        if(seen.has(value))return '[circular]';
        seen.add(value);
        if(Array.isArray(value))return value.slice(0,20000).map(entry=>sanitize(entry,depth+1));
        const result:Record<string,unknown>={};
        for(const [key,item] of Object.entries(value)){
            if(forbiddenKey.test(key)){result[key]='[credential redacted]';continue}
            result[key]=sanitize(item,depth+1);
        }
        return result;
    };
    const result=sanitize(raw,0);
    return result && typeof result==='object' && !Array.isArray(result)?result as Record<string,unknown>:{value:result};
}
