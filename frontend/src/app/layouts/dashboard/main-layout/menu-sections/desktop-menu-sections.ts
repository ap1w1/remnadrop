import { DpiCheckerLogo } from '@shared/ui/logos/dpi-checker-logo'
import { useHotkeys } from '@mantine/hooks'
import { SUBSCRIPTION_TEMPLATE_TYPE } from '@remnawave/backend-contract'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HiChartPie, HiServer } from 'react-icons/hi'
import {
    PiAirTrafficControlDuotone,
    PiArrowsInCardinalFill,
    PiChartLine,
    PiListChecks,
    PiUsers
} from 'react-icons/pi'
import {
    TbArchive,
    TbBell,
    TbCertificate,
    TbCloud,
    TbShieldCheck,
    TbHierarchy3,
    TbChartArcs,
    TbCirclesRelation,
    TbCode,
    TbCreditCard,
    TbDeviceAnalytics,
    TbBook2,
    TbFlame,
    TbFolder,
    TbHexagon,
    TbPackage,
    TbRadar2,
    TbReportAnalytics,
    TbRoute,
    TbStar,
    TbTools,
    TbWebhook
} from 'react-icons/tb'

import { ROUTES } from '@shared/constants'
import { Logo } from '@shared/ui'
import { MihomoLogo, SingboxLogo, StashLogo, XrayLogo } from '@shared/ui/logos'

import { MenuItem } from './interfaces'

export const useDesktopMenuSections = (): MenuItem[] => {
    const { t } = useTranslation()
    const [showDevMenu, setShowDevMenu] = useState(false)

    useHotkeys([['mod+shift+J', () => setShowDevMenu((prev) => !prev)]])

    const menuSections: MenuItem[] = [
        {
            header: t('constants.overview'),
            id: 'home',
            icon: TbStar,
            section: [
                {
                    name: t('constants.home'),
                    href: ROUTES.DASHBOARD.HOME,
                    icon: TbStar,
                    id: 'home'
                },
                {
                    name: 'События', href: ROUTES.DASHBOARD.EVENTS, icon: TbBell, id: 'events'
                }
            ]
        },
        {
            header: t('constants.users'),
            id: 'users',
            icon: PiUsers,
            section: [
                {
                    name: t('constants.users'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.USERS,
                    icon: PiUsers,
                    id: 'users'
                },
                {
                    name: t('constants.internal-squads'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.INTERNAL_SQUADS,
                    icon: TbCirclesRelation,
                    id: 'internal-squads'
                },
                {
                    name: t('constants.external-squads'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.EXTERNAL_SQUADS,
                    icon: TbWebhook,
                    id: 'external-squads'
                }
            ]
        },
        {
            header: t('constants.nodes'),
            id: 'nodes',
            icon: HiServer,
            section: [
                {
                    name: t('constants.nodes'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.NODES,
                    icon: HiServer,
                    id: 'nodes-management'
                },
                                { name: 'Мониторинг', id: 'monitoring', href: '/dashboard/management/monitoring', icon: TbDeviceAnalytics },
                                {name:'Автоматизации',id:'automations',href:'/dashboard/management/automations',icon:TbRoute},
                                {name:'Схема связей',id:'node-topology',href:'/dashboard/management/topology',icon:TbHierarchy3},
                {
                    name: `${t('constants.node-plugins')} β`,
                    href: ROUTES.DASHBOARD.MANAGEMENT.NODE_PLUGINS.ROOT,
                    icon: TbPackage,
                    id: 'node-plugins'
                },
                {
                    name: t('constants.nodes-statistics'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.NODES_STATS,
                    icon: HiChartPie,
                    id: 'nodes-statistics'
                },
                {
                    name: t('constants.infra-billing'),
                    href: ROUTES.DASHBOARD.CRM.INFRA_BILLING,
                    icon: TbCreditCard,
                    id: 'infra-billing'
                },
                {
                    name: t('constants.nodes-metrics'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.NODES_METRICS,
                    icon: PiChartLine,
                    id: 'nodes-metrics'
                },

                {
                    name: t('constants.nodes-bandwidth-table'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.NODES_BANDWIDTH_TABLE,
                    icon: TbChartArcs,
                    id: 'nodes-bandwidth-table'
                }
            ]
        },
        {
            header: t('constants.config-profiles'),
            id: 'profiles',
            icon: XrayLogo,
            section: [
                {
                    name: t('constants.config-profiles'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.CONFIG_PROFILES,
                    icon: XrayLogo,
                    id: 'config-profiles'
                }
            ]
        },
        {
            header: t('constants.tools'),
            id: 'tools',
            icon: TbTools,
            section: [
                { name: 'Limiter', id: 'limiter', href: ROUTES.DASHBOARD.TOOLS.LIMITER, icon: TbShieldCheck },
                { name: 'Cloudflare DNS', id: 'cloudflare-dns', href: ROUTES.DASHBOARD.TOOLS.CLOUDFLARE_DNS, icon: TbCloud },
{name:'DPI Checker',id:'dpi-checker',href:'/dashboard/management/dpi-checker',icon:DpiCheckerLogo},
{name:'SSL-сертификаты',id:'ssl-certificates',href:ROUTES.DASHBOARD.MANAGEMENT.SSL_CERTIFICATES,icon:TbCertificate},
                {
                    name: t('constants.hwid-inspector'),
                    href: ROUTES.DASHBOARD.TOOLS.HWID_INSPECTOR,
                    icon: TbDeviceAnalytics,
                    id: 'hwid-inspector'
                },
                {
                    name: t('constants.srh-inspector'),
                    href: ROUTES.DASHBOARD.TOOLS.SRH_INSPECTOR,
                    icon: TbReportAnalytics,
                    id: 'srh-inspector'
                },
                {
                    name: t('constants.tb-reports'),
                    href: ROUTES.DASHBOARD.TOOLS.TORRENT_BLOCKER_REPORTS,
                    icon: TbFlame,
                    id: 'torrent-blocker-reports'
                },
                {
                    name: t('constants.sessions-explorer'),
                    href: ROUTES.DASHBOARD.TOOLS.SESSIONS_EXPLORER,
                    icon: TbRadar2,
                    id: 'sessions-explorer'
                }
            ]
        },
        {
            header: t('constants.subscription'),
            id: 'subscription',
            icon: TbHexagon,
            section: [
                {
                    name: t('constants.hosts'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.HOSTS,
                    icon: PiListChecks,
                    id: 'hosts'
                },
                {
                    name: t('constants.templates'),
                    href: ROUTES.DASHBOARD.TEMPLATES.ROOT,
                    icon: TbFolder,
                    id: 'templates',
                    dropdownItems: [
                        {
                            name: 'Xray JSON',
                            href: ROUTES.DASHBOARD.TEMPLATES.TEMPLATES_BY_TYPE.replace(
                                ':type',
                                SUBSCRIPTION_TEMPLATE_TYPE.XRAY_JSON
                            ),
                            icon: XrayLogo,
                            id: 'xray-json'
                        },
                        {
                            name: 'Mihomo',
                            href: ROUTES.DASHBOARD.TEMPLATES.TEMPLATES_BY_TYPE.replace(
                                ':type',
                                SUBSCRIPTION_TEMPLATE_TYPE.MIHOMO
                            ),
                            icon: MihomoLogo,
                            id: 'mihomo'
                        },
                        {
                            name: 'Stash',
                            href: ROUTES.DASHBOARD.TEMPLATES.TEMPLATES_BY_TYPE.replace(
                                ':type',
                                SUBSCRIPTION_TEMPLATE_TYPE.STASH
                            ),
                            icon: StashLogo,
                            id: 'stash'
                        },
                        {
                            name: 'Singbox',
                            href: ROUTES.DASHBOARD.TEMPLATES.TEMPLATES_BY_TYPE.replace(
                                ':type',
                                SUBSCRIPTION_TEMPLATE_TYPE.SINGBOX
                            ),
                            icon: SingboxLogo,
                            id: 'singbox'
                        },
                        {
                            name: 'Clash',
                            href: ROUTES.DASHBOARD.TEMPLATES.TEMPLATES_BY_TYPE.replace(
                                ':type',
                                SUBSCRIPTION_TEMPLATE_TYPE.CLASH
                            ),
                            icon: MihomoLogo,
                            id: 'clash'
                        }
                    ]
                },
                {
                    name: t('constants.subscription-settings'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.SUBSCRIPTION_SETTINGS,
                    icon: TbHexagon,
                    id: 'subscription-settings'
                },
                {
                    name: t('constants.response-rules'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.RESPONSE_RULES,
                    icon: TbRoute,
                    id: 'response-rules'
                },
                {
                    name: 'Subscription Page',
                    href: ROUTES.DASHBOARD.SUBPAGE_CONFIGS.ROOT,
                    icon: PiArrowsInCardinalFill,
                    id: 'subscription-page'
                }
            ]
        },
        {
            header: t('constants.subscription-settings'),
            id: 'settings',
            icon: Logo,
            section: [
                {
                    name: t('constants.remnawave-settings'),
                    href: ROUTES.DASHBOARD.MANAGEMENT.REMNAWAVE_SETTINGS,
                    icon: Logo,
                    id: 'remnawave-settings'
                }
            ]
        }
    ]

    menuSections.push({header:'Бэкапы',id:'backups-section',icon:TbArchive,section:[{name:'Бэкапы',id:'backups',href:'/dashboard/backups',icon:TbArchive}]})

    // Documentation is deliberately the last regular navigation section.
    menuSections.push({
        header:'Документация',id:'api-documentation',icon:TbBook2,
        section:[{name:'Документация',id:'api-documentation',href:'/dashboard/documentation',icon:TbBook2}]
    })

    if (showDevMenu) {
        menuSections.push({
            header: 'Dev Menu',
            id: 'dev-menu',
            icon: TbCode,
            section: [
                {
                    name: 'Queues Viewer',
                    href: '/api/queues',
                    icon: PiAirTrafficControlDuotone,
                    id: 'queues-viewer',
                    newTab: true
                }
            ]
        })
    }

    return menuSections
}

