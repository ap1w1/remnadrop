import {
    APP_CONFIG_ROUTE_LEADING_PATH,
    SubscriptionPageRawConfigSchema
} from '@remnawave/subscription-page-types'
import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract'
import { Outlet } from 'react-router'
import type { CSSProperties } from 'react'
import { useLayoutEffect } from 'react'
import consola from 'consola/browser'
import { ofetch } from 'ofetch'

import {
    useSubscriptionInfoStoreActions,
    useSubscriptionInfoStoreInfo
} from '@entities/subscription-info-store'
import { useAppConfigNullable, useAppConfigStoreActions, useIsConfigLoaded } from '@entities/app-config-store'
import { LoadingScreen } from '@shared/ui'
import { parsePageColors } from '@shared/utils/page-colors'

import classes from './root.module.css'

export function RootLayout() {
    const subscriptionActions = useSubscriptionInfoStoreActions()
    const configActions = useAppConfigStoreActions()

    const { subscription } = useSubscriptionInfoStoreInfo()
    const isConfigLoaded = useIsConfigLoaded()
    const config = useAppConfigNullable()
    const pageColors = parsePageColors((config?.brandingSettings as { pageColors?: unknown } | undefined)?.pageColors)
    const pageStyle = {
        '--page-background': pageColors.background,
        '--page-surface': pageColors.surface,
        '--page-accent': pageColors.accent,
        '--page-text': pageColors.text,
        '--mantine-color-body': pageColors.background,
        '--mantine-color-dark-7': pageColors.surface,
        '--mantine-color-cyan-4': pageColors.accent,
        '--mantine-color-cyan-5': pageColors.accent,
        '--mantine-color-cyan-8': pageColors.accent,
        '--mantine-color-white': pageColors.text,
        '--mantine-color-text': pageColors.text
    } as CSSProperties

    useLayoutEffect(() => {
        const subPageDiv = document.getElementById('sbpg')

        if (subPageDiv) {
            const subscriptionUrl = subPageDiv.dataset.panel

            if (subscriptionUrl) {
                try {
                    const subscription: GetSubscriptionInfoByShortUuidCommand.Response = JSON.parse(
                        atob(subscriptionUrl)
                    )

                    subscriptionActions.setSubscriptionInfo({
                        subscription: subscription.response
                    })
                } catch (error) {
                    consola.log(error)
                } finally {
                    subPageDiv.remove()
                }
            }
        }

        const fetchConfig = async () => {
            try {
                const tempConfig = await ofetch<unknown>(
                    `${APP_CONFIG_ROUTE_LEADING_PATH}?v=${Date.now()}`,
                    {
                        parseResponse: (response) => JSON.parse(response)
                    }
                )

                const parsedConfig =
                    await SubscriptionPageRawConfigSchema.safeParseAsync(tempConfig)

                if (!parsedConfig.success) {
                    consola.error('Failed to parse app config:', parsedConfig.error)
                    return
                }

                const rawBranding = (tempConfig as { brandingSettings?: { pageColors?: unknown } })?.brandingSettings
                Object.assign(parsedConfig.data.brandingSettings, {
                    pageColors: parsePageColors(rawBranding?.pageColors)
                })
                configActions.setConfig(parsedConfig.data)
            } catch (error) {
                consola.error('Failed to fetch app config:', error)
            }
        }

        fetchConfig()
    }, [])

    if (!isConfigLoaded || !subscription) {
        return (
            <div className={classes.root} style={pageStyle}>
                <div className="animated-background"></div>
                <div className={classes.content}>
                    <main className={classes.main}>
                        <LoadingScreen height="100vh" />
                    </main>
                </div>
            </div>
        )
    }

    return (
        <div className={classes.root} style={pageStyle}>
            <div className="animated-background"></div>
            <div className={classes.content}>
                <main className={classes.main}>
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
