import type { SVGProps } from 'react'

export function DpiCheckerLogo(props: SVGProps<SVGSVGElement>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"
             fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round"
             aria-hidden="true" focusable="false" {...props}>
            <path d="M12 2.8 20 7.2v9.6L12 21.2 4 16.8V7.2L12 2.8Z"/>
            <path d="m4 7.2 8 4.4 8-4.4M12 11.6v9.6"/>
            <path d="m15 12.2 2-1.1M15 15 17 13.9"/>
        </svg>
    )
}
