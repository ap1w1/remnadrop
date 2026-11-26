import { IconBrandTelegram, IconExternalLink, IconHeadset, IconInfoCircle, IconLink, IconServer, IconWorld } from '@tabler/icons-react'
import { Badge, Box, Group, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'

import { useSubscription } from '@entities/subscription-info-store'
import { useCurrentLang } from '@entities/app-config-store'

import classes from './remnadrop-extras.module.css'

type QuotaGroup = {
    name: string
    usedBytes: string
    limitBytes: string
    blocked: boolean
    nodes: { name: string; countryCode: string }[]
}

type PageLinks = Partial<Record<'supportUrl' | 'telegramChannel' | 'telegramBot' | 'webPage' | 'webPageStub', string>>

const translations = {
    ru: { support: 'Поддержка', channel: 'Telegram канал', bot: 'Telegram бот', site: 'Сайт', info: 'Информация', quotas: 'Лимиты по нодам', exhausted: 'Лимит исчерпан', links: 'Полезные ссылки' },
    en: { support: 'Support', channel: 'Telegram channel', bot: 'Telegram bot', site: 'Website', info: 'Information', quotas: 'Node limits', exhausted: 'Limit reached', links: 'Useful links' },
    fr: { support: 'Assistance', channel: 'Canal Telegram', bot: 'Bot Telegram', site: 'Site web', info: 'Informations', quotas: 'Limites des nœuds', exhausted: 'Limite atteinte', links: 'Liens utiles' },
    zh: { support: '支持', channel: 'Telegram 频道', bot: 'Telegram 机器人', site: '网站', info: '信息', quotas: '节点流量限制', exhausted: '额度已用尽', links: '常用链接' },
    fa: { support: 'پشتیبانی', channel: 'کانال تلگرام', bot: 'ربات تلگرام', site: 'وب‌سایت', info: 'اطلاعات', quotas: 'محدودیت گره‌ها', exhausted: 'سقف مصرف', links: 'پیوندهای مفید' }
} as const

function formatBytes(raw: string, locale: string): string {
    const value = Number(raw)
    if (!Number.isFinite(value)) return '—'
    const units = locale === 'ru' ? ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ', 'ПиБ'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    let scaled = Math.max(0, value)
    let index = 0
    while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024
        index++
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index === 0 ? 0 : 2 }).format(scaled)} ${units[index]}`
}

function flag(countryCode: string): string {
    if (!/^[A-Z]{2}$/.test(countryCode)) return '🌐'
    return String.fromCodePoint(...[...countryCode].map(char => char.charCodeAt(0) + 127397))
}

export function RemnadropExtrasWidget() {
    const subscription = useSubscription()
    const currentLang = useCurrentLang()
    const labels = translations[currentLang as keyof typeof translations] ?? translations.en
    const extra = subscription as typeof subscription & {
        user: typeof subscription.user & { nodeQuotaGroups?: QuotaGroup[] }
        pageLinks?: PageLinks | null
    }
    const links = [
        { key: 'supportUrl', label: labels.support, Icon: IconHeadset },
        { key: 'telegramChannel', label: labels.channel, Icon: IconBrandTelegram },
        { key: 'telegramBot', label: labels.bot, Icon: IconBrandTelegram },
        { key: 'webPage', label: labels.site, Icon: IconWorld },
        { key: 'webPageStub', label: labels.info, Icon: IconInfoCircle }
    ] as const
    const availableLinks = links.flatMap(item => {
        const href = extra.pageLinks?.[item.key]
        if (!href) return []
        try {
            const url = new URL(href)
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
        } catch {
            return []
        }
        return [{ ...item, href }]
    })
    const groups = extra.user.nodeQuotaGroups ?? []

    if (!availableLinks.length && !groups.length) return null

    return <Stack gap="lg">
        {availableLinks.length > 0 && <section aria-label={labels.links}>
            <Group gap="xs" mb="sm" className={classes.sectionTitle}>
                <IconLink size={20} className={classes.headingIcon} />
                <Title order={2} size="h4">{labels.links}</Title>
            </Group>
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
                {availableLinks.map(({ key, label, Icon, href }) => <Box
                    component="a"
                    href={href}
                    key={key}
                    className={classes.link}
                    rel="noopener noreferrer"
                    target="_blank"
                >
                    <ThemeIcon variant="light" radius="md" size={38} className={classes.icon}><Icon size={20} /></ThemeIcon>
                    <Text fw={600} size="sm">{label}</Text>
                    <IconExternalLink size={15} className={classes.external} />
                </Box>)}
            </SimpleGrid>
        </section>}
        {groups.length > 0 && <section aria-label={labels.quotas}>
            <Group gap="xs" mb="sm" className={classes.sectionTitle}>
                <IconServer size={19} className={classes.headingIcon} />
                <Title order={2} size="h4">{labels.quotas}</Title>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {groups.map(group => {
                    const used = Number(group.usedBytes)
                    const limit = Number(group.limitBytes)
                    const percent = limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0
                    return <Box className={classes.quota} key={group.name}>
                        <Group justify="space-between" align="start" gap="xs">
                            <Text fw={700} className={classes.quotaName}>{group.name}</Text>
                            {group.blocked ? <Badge color="red" size="sm">{labels.exhausted}</Badge> : limit > 0 && <Badge color="cyan" variant="light" size="sm">{Math.round(percent)}%</Badge>}
                        </Group>
                        <Text size="sm" mt="xs" className={classes.quotaAmount}>
                            <strong>{formatBytes(group.usedBytes, currentLang)}</strong><span> / {limit > 0 ? formatBytes(group.limitBytes, currentLang) : '∞'}</span>
                        </Text>
                        {limit > 0 && <Progress value={percent} color={group.blocked ? 'red' : 'cyan'} mt="md" size="sm" radius="xl" />}
                        {group.nodes.length > 0 && <div className={classes.nodeChips}>
                            {group.nodes.map(node => <span className={classes.nodeChip} key={node.name}>{flag(node.countryCode)} {node.name}</span>)}
                        </div>}
                    </Box>
                })}
            </SimpleGrid>
        </section>}
    </Stack>
}
