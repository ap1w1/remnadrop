import { ActionIcon, Card, ColorInput, CopyButton, Divider, Group, Popover, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { UseFormReturnType } from '@mantine/form'
import { TSubscriptionPageRawConfig } from '@remnawave/subscription-page-types'
import { IconInfoCircle, IconPalette } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { BaseOverlayHeader } from '@shared/ui/overlays/base-overlay-header'

import styles from '../subpage-config-visual-editor.module.css'

interface IProps {
    form: UseFormReturnType<TSubscriptionPageRawConfig>
}

export function BrandingBlockComponent({ form }: IProps) {
    const { t } = useTranslation()

    return (
        <Card className={styles.sectionCard} p="lg" radius="lg">
            <Stack gap="md" h="100%">
                <BaseOverlayHeader
                    iconColor="cyan"
                    IconComponent={IconPalette}
                    iconSize={20}
                    iconVariant="soft"
                    subtitle={t('subpage-config-visual-editor.widget.brand-appearance')}
                    title={t('subpage-config-visual-editor.widget.branding')}
                    titleOrder={5}
                />

                <Divider className={styles.divider} />

                <TextInput
                    classNames={{ input: styles.inputDark }}
                    key={form.key('brandingSettings.title')}
                    label={t('subpage-config-visual-editor.widget.brand-title')}
                    placeholder={t('subpage-config-visual-editor.widget.your-brand-name')}
                    required
                    {...form.getInputProps('brandingSettings.title')}
                />

                <TextInput
                    classNames={{ input: styles.inputDark }}
                    key={form.key('brandingSettings.logoUrl')}
                    label={t('subpage-config-visual-editor.widget.logo-url')}
                    placeholder="https://example.com/logo.png"
                    required
                    {...form.getInputProps('brandingSettings.logoUrl')}
                />

                <Stack gap="xs">
                    <Text fw={600} size="sm">Цвета страницы</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        {([
                            ['background', 'Фон страницы', '#0D1117'],
                            ['surface', 'Карточки', '#161B22'],
                            ['accent', 'Акцент и кнопки', '#22C7D9'],
                            ['text', 'Основной текст', '#E6EDF3']
                        ] as const).map(([colorKey, label, fallback]) => (
                            <ColorInput
                                key={form.key(`brandingSettings.pageColors.${colorKey}`)}
                                label={label}
                                format="hex"
                                swatches={['#22C7D9', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#0D1117', '#161B22', '#E6EDF3']}
                                {...form.getInputProps(`brandingSettings.pageColors.${colorKey}`)}
                                defaultValue={form.getValues().brandingSettings &&
                                    (form.getValues().brandingSettings as typeof form.values.brandingSettings & { pageColors?: Record<string, string> }).pageColors?.[colorKey] || fallback}
                            />
                        ))}
                    </SimpleGrid>
                    <Text size="xs" c="dimmed">Цвета применяются к странице подписки после сохранения конфигурации.</Text>
                </Stack>

                <Group gap="xs" align="center" justify="space-between">
                    <Text fw={600} size="sm">Ссылки и UTM-переменные</Text>
                    <Popover width={310} position="bottom-end" withArrow shadow="md">
                        <Popover.Target>
                            <Tooltip label="Доступные переменные"><ActionIcon variant="subtle" aria-label="Информация о переменных ссылок"><IconInfoCircle size={19}/></ActionIcon></Tooltip>
                        </Popover.Target>
                        <Popover.Dropdown>
                            <Stack gap="xs"><Text fw={600} size="sm">Переменные подписчика</Text>
                                <Text size="xs" c="dimmed">Вставьте переменную в URL, значение подставляется на сервере и кодируется для ссылки. Нажмите для копирования.</Text>
                                {([['{{EMAIL}}','E-mail'],['{{ID}}','Числовой ID'],['{{USERNAME}}','Имя пользователя'],['{{TELEGRAM_ID}}','Telegram ID']] as const).map(([variable,description])=><CopyButton value={variable} key={variable}>
                                    {({copied,copy})=><Tooltip label={copied?'Скопировано':'Нажать для копирования'}>
                                        <Group justify="space-between" gap="xs" style={{cursor:'pointer'}} onClick={copy}>
                                            <Text ff="monospace" size="xs" c={copied?'teal':undefined}>{variable}</Text><Text size="xs" c="dimmed">{description}</Text>
                                        </Group>
                                    </Tooltip>}
                                </CopyButton>)}
                            </Stack>
                        </Popover.Dropdown>
                    </Popover>
                </Group>
                {([
                    ['supportUrl','support-url','https://t.me/support?start={{ID}}'],
                    ['telegramChannel','telegram-channel','https://t.me/channel?utm_content={{USERNAME}}'],
                    ['telegramBot','telegram-bot','https://t.me/bot?start={{ID}}'],
                    ['webPage','web-page','https://example.com/?utm_source={{EMAIL}}'],
                    ['webPageStub','web-page-stub','https://example.com/info?ref={{TELEGRAM_ID}}']
                ] as const).map(([key,label,placeholder])=><TextInput
                    key={form.key(`brandingSettings.${key}`)}
                    classNames={{input:styles.inputDark}}
                    label={label}
                    placeholder={placeholder}
                    description={key==='supportUrl'?'Если пусто — используется ссылка поддержки из общих настроек Remnawave':'Необязательно; пустое значение скрывает ссылку'}
                    {...form.getInputProps(`brandingSettings.${key}`)}
                />)}
            </Stack>
        </Card>
    )
}
