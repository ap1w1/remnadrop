import { IconCalendarTime, IconChartPie, IconCircleCheck, IconCircleX, IconClock, IconInfinity, IconWifi } from '@tabler/icons-react'
import { Badge, Group, Text } from '@mantine/core'

import { useSubscription } from '@entities/subscription-info-store'
import { useCurrentLang } from '@entities/app-config-store'
import { formatDate } from '@shared/utils/config-parser'
import { useTranslation } from '@shared/hooks'
import { SubscriptionLinkWidget } from '@widgets/main'

import classes from './remnadrop-overview.module.css'

type Variant = 'cards' | 'collapsed' | 'expanded'

const copy = {
    ru: { eyebrow: 'Ваша подписка', intro: 'Подключение и управление доступом в одном месте', used: 'Использовано', left: 'Осталось', expires: 'Действует до', days: 'дней осталось', unlimited: 'Без лимита', active: 'Доступ активен', inactive: 'Доступ недоступен', traffic: 'Трафик подписки' },
    en: { eyebrow: 'Your subscription', intro: 'Your connection and access in one place', used: 'Used', left: 'Remaining', expires: 'Valid until', days: 'days left', unlimited: 'Unlimited', active: 'Access active', inactive: 'Access unavailable', traffic: 'Subscription traffic' },
    fr: { eyebrow: 'Votre abonnement', intro: 'Connexion et accès au même endroit', used: 'Utilisé', left: 'Restant', expires: 'Valable jusqu’au', days: 'jours restants', unlimited: 'Illimité', active: 'Accès actif', inactive: 'Accès indisponible', traffic: 'Trafic de l’abonnement' },
    zh: { eyebrow: '您的订阅', intro: '在一个页面管理连接和访问', used: '已使用', left: '剩余', expires: '有效期至', days: '天剩余', unlimited: '无限制', active: '访问正常', inactive: '访问不可用', traffic: '订阅流量' },
    fa: { eyebrow: 'اشتراک شما', intro: 'اتصال و دسترسی در یک صفحه', used: 'مصرف‌شده', left: 'باقی‌مانده', expires: 'معتبر تا', days: 'روز باقی‌مانده', unlimited: 'نامحدود', active: 'دسترسی فعال', inactive: 'دسترسی غیرفعال', traffic: 'ترافیک اشتراک' }
} as const

function formatRemaining(limitRaw: string, usedRaw: string, fallback: string) {
    const limit = Number(limitRaw)
    const used = Number(usedRaw)
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0) return fallback
    const remaining = Math.max(0, limit - used)
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    let value = remaining
    let index = 0
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index ? 2 : 0 }).format(value)} ${units[index]}`
}

interface Props { variant: Variant; hideGetLink: boolean }

export function RemnadropOverviewWidget({ variant, hideGetLink }: Props) {
    const subscription = useSubscription()
    const language = useCurrentLang()
    const { currentLang, baseTranslations } = useTranslation()
    const labels = copy[language as keyof typeof copy] ?? copy.en
    const { user } = subscription
    const active = user.userStatus === 'ACTIVE'
    const limit = Number(user.trafficLimitBytes)
    const used = Number(user.trafficUsedBytes)
    const percent = limit > 0 && Number.isFinite(used) ? Math.min(100, Math.max(0, used / limit * 100)) : 0
    const unlimited = limit <= 0
    const remaining = formatRemaining(user.trafficLimitBytes, user.trafficUsedBytes, labels.unlimited)
    const expires = formatDate(user.expiresAt, currentLang, baseTranslations)

    return <section className={`${classes.hero} ${variant === 'collapsed' ? classes.compact : ''}`} aria-label={labels.eyebrow}>
        <div className={classes.heroContent}>
            <div className={classes.eyebrow}><IconWifi size={16} />{labels.eyebrow}</div>
            <h1 className={classes.username}>{user.username}</h1>
            <Text className={classes.intro}>{labels.intro}</Text>
            <Group gap="sm" mt="lg" wrap="wrap">
                <Badge variant="light" color={active ? 'teal' : 'red'} size="lg" leftSection={active ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}>
                    {active ? labels.active : labels.inactive}
                </Badge>
                {user.daysLeft > 0 && <span className={classes.days}><IconClock size={16} />{user.daysLeft} {labels.days}</span>}
            </Group>
            {!hideGetLink && <div className={classes.actions}><SubscriptionLinkWidget hideGetLink={false} mode="hero" /></div>}
        </div>

        {variant !== 'collapsed' && <div className={classes.trafficPanel}>
            <div className={classes.trafficTop}><IconChartPie size={18} />{labels.traffic}</div>
            <div className={classes.trafficMain}>
                <div className={classes.ring} style={{ background: unlimited ? 'conic-gradient(var(--page-accent) 100%, transparent 0)' : `conic-gradient(var(--page-accent) ${percent}%, rgba(255,255,255,.1) 0)` }}>
                    <div className={classes.ringInner}>{unlimited ? <IconInfinity size={32} /> : <><strong>{Math.round(percent)}%</strong><span>{labels.used}</span></>}</div>
                </div>
                <div className={classes.trafficNumbers}>
                    <strong>{user.trafficUsed}</strong>
                    <span>{unlimited ? labels.unlimited : `/ ${user.trafficLimit}`}</span>
                </div>
            </div>
            <div className={classes.trafficBottom}><span>{labels.left}</span><strong>{remaining}</strong></div>
        </div>}

        {variant !== 'collapsed' && <div className={classes.metrics}>
            <div className={classes.metric}><IconCalendarTime size={20} /><div><span>{labels.expires}</span><strong>{expires}</strong></div></div>
            <div className={classes.metric}><IconChartPie size={20} /><div><span>{labels.used}</span><strong>{user.trafficUsed}</strong></div></div>
            <div className={classes.metric}><IconInfinity size={20} /><div><span>{labels.left}</span><strong>{remaining}</strong></div></div>
        </div>}
        {variant === 'collapsed' && <div className={classes.compactExpiry}><IconCalendarTime size={18} />{labels.expires}: {expires}</div>}
    </section>
}
