import { emojiFlag } from './resolve-country-code'

export type NodeOptionData = {uuid:string;name:string;address?:string|null;countryCode?:string|null}
/** Consistent label for all node dropdowns (name, flag and actual management IP/hostname). */
export function nodeOptionLabel(node:NodeOptionData):string {
    const flag=node.countryCode && node.countryCode!=='XX' ? emojiFlag(node.countryCode) : '🌐'
    return `${flag} ${node.name}${node.address ? ` · ${node.address}` : ''}`
}
