import { IconCopy, IconQrcode } from '@tabler/icons-react'
import { Button, Group, Image, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useClipboard } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { renderSVG } from 'uqr'

import { constructSubscriptionUrl } from '@shared/utils/construct-subscription-url'
import { useSubscription } from '@entities/subscription-info-store'
import { vibrate } from '@shared/utils/vibrate'
import { useTranslation } from '@shared/hooks'
import { useAppConfig } from '@entities/app-config-store'
import { parsePageColors } from '@shared/utils/page-colors'

import classes from './subscription-link.module.css'

interface IProps {
    hideGetLink: boolean
    mode?: 'hero' | 'icon'
}

export const SubscriptionLinkWidget = ({ hideGetLink, mode = 'hero' }: IProps) => {
    const { t, baseTranslations } = useTranslation()
    const subscription = useSubscription()
    const config = useAppConfig()
    const palette = parsePageColors((config.brandingSettings as { pageColors?: unknown }).pageColors)
    const clipboard = useClipboard({ timeout: 10000 })

    const subscriptionUrl = constructSubscriptionUrl(
        window.location.href,
        subscription.user.shortUuid
    )

    const handleCopy = () => {
        notifications.show({
            title: t(baseTranslations.linkCopied),
            message: t(baseTranslations.linkCopiedToClipboard),
            color: 'cyan'
        })
        clipboard.copy(subscriptionUrl)
    }

    const handleGetLink = () => {
        vibrate('tap')

        const subscriptionQrCode = renderSVG(subscriptionUrl, {
            whiteColor: palette.surface,
            blackColor: palette.accent
        })

        modals.open({
            centered: true,
            title: t(baseTranslations.getLink),
            classNames: {
                content: classes.modalContent,
                header: classes.modalHeader,
                title: classes.modalTitle
            },
            styles: { content: { background: palette.surface, color: palette.text } },
            children: (
                <Stack align="center">
                    <Image
                        src={`data:image/svg+xml;utf8,${encodeURIComponent(subscriptionQrCode)}`}
                        style={{ borderRadius: 'var(--mantine-radius-md)' }}
                    />
                    <Text c="white" fw={600} size="lg" ta="center">
                        {t(baseTranslations.scanQrCode)}
                    </Text>
                    <Text c="dimmed" size="sm" ta="center">
                        {t(baseTranslations.scanQrCodeDescription)}
                    </Text>

                    <Button
                        fullWidth
                        leftSection={<IconCopy />}
                        onClick={handleCopy}
                        radius="md"
                        variant="light"
                    >
                        {t(baseTranslations.copyLink)}
                    </Button>
                </Stack>
            )
        })
    }

    if (hideGetLink) return null

    return <Group gap="sm" wrap="wrap">
        <Button className={classes.primaryAction} leftSection={<IconQrcode size={19} />} onClick={handleGetLink} radius="md" size={mode === 'hero' ? 'md' : 'sm'}>
            {t(baseTranslations.getLink)}
        </Button>
        {mode === 'hero' && <Button className={classes.secondaryAction} leftSection={<IconCopy size={18} />} onClick={handleCopy} radius="md" size="md" variant="default">
            {t(baseTranslations.copyLink)}
        </Button>}
    </Group>
}
