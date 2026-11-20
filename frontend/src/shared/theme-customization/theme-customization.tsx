import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTheme, MantineProvider, v8CssVariablesResolver, type MantineColorsTuple } from '@mantine/core'
import { theme } from '@shared/constants'

export type ThemeColors = { accent: string; background: string; surface: string }
export const DEFAULT_COLORS: ThemeColors = { accent: '#06b6d4', background: '#0d1117', surface: '#161b22' }
const KEY = 'remnadrop:appearance:v1'
const HEX = /^#[0-9a-fA-F]{6}$/
function validated(x: unknown): ThemeColors {
    if (!x || typeof x !== 'object') return DEFAULT_COLORS
    const item = x as Record<string,unknown>
    return {
        accent: typeof item.accent === 'string' && HEX.test(item.accent) ? item.accent : DEFAULT_COLORS.accent,
        background: typeof item.background === 'string' && HEX.test(item.background) ? item.background : DEFAULT_COLORS.background,
        surface: typeof item.surface === 'string' && HEX.test(item.surface) ? item.surface : DEFAULT_COLORS.surface
    }
}
function load(): ThemeColors {
    try {return validated(JSON.parse(localStorage.getItem(KEY) ?? 'null'))} catch {return DEFAULT_COLORS}
}
function tone(hex:string, influence:number) {
    const n=parseInt(hex.slice(1),16), base=[n>>16&255,n>>8&255,n&255]
    const target=influence >=0?255:0, f=Math.abs(influence)
    return '#'+base.map(v=>Math.round(v+(target-v)*f).toString(16).padStart(2,'0')).join('')
}
function palette(hex:string):MantineColorsTuple {
    return [tone(hex,.92),tone(hex,.83),tone(hex,.70),tone(hex,.50),tone(hex,.30),hex,tone(hex,-.14),tone(hex,-.27),tone(hex,-.41),tone(hex,-.56)]
}
type Ctx = {colors:ThemeColors; setColors:(next:ThemeColors)=>void; reset:()=>void}
const Context = createContext<Ctx | null>(null)
export function useAppearance(){const v=useContext(Context);if(!v)throw Error('Appearance provider missing');return v}
export function AppearanceProvider({children}:{children:ReactNode}) {
    const [colors,setColors] = useState<ThemeColors>(load)
    const accentChanged = colors.accent.toLowerCase() !== DEFAULT_COLORS.accent
    const backgroundChanged = colors.background.toLowerCase() !== DEFAULT_COLORS.background
    const surfaceChanged = colors.surface.toLowerCase() !== DEFAULT_COLORS.surface
    const safeColors = useMemo(()=>validated(colors),[colors])
    const dynamicTheme = useMemo(()=>createTheme({
        ...theme,
        primaryColor: accentChanged ? 'brand' : 'cyan',
        colors: {...theme.colors, brand:palette(safeColors.accent)},
    }),[safeColors.accent,accentChanged])
    useEffect(()=>{
        try{localStorage.setItem(KEY,JSON.stringify(colors))}catch{/* storage disabled */}
        const el=document.documentElement
        // Apply surface/background independently: changing accent must not recolor the top bar.
        el.dataset.remnadropAccent=accentChanged?'custom':'default'
        el.dataset.remnadropBackground=backgroundChanged?'custom':'default'
        el.dataset.remnadropSurface=surfaceChanged?'custom':'default'
        el.style.setProperty('--remnadrop-background',safeColors.background)
        el.style.setProperty('--remnadrop-surface',safeColors.surface)
        el.style.setProperty('--remnadrop-accent',safeColors.accent)
    },[colors,accentChanged,backgroundChanged,surfaceChanged,safeColors])
    const value=useMemo(()=>({colors,setColors,reset:()=>setColors(DEFAULT_COLORS)}),[colors])
    return <Context.Provider value={value}><MantineProvider cssVariablesResolver={v8CssVariablesResolver} defaultColorScheme="dark" theme={dynamicTheme} deduplicateInlineStyles>{children}</MantineProvider></Context.Provider>
}
