import { Button, Card, ColorInput, Divider, Group, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core'
import { UseFormReturnType } from '@mantine/form'
import { TSubscriptionPageRawConfig } from '@remnawave/subscription-page-types'
import { IconCheck, IconPalette } from '@tabler/icons-react'
import { useState } from 'react'

import { BaseOverlayHeader } from '@shared/ui/overlays/base-overlay-header'

import styles from '../subpage-config-visual-editor.module.css'

type PageColors = { background: string; surface: string; accent: string; text: string }
type ColorKey = keyof PageColors

const presets: { label: string; colors: PageColors }[] = [
    { label: 'RemnaDrop', colors: { background: '#0D1117', surface: '#161B22', accent: '#22C7D9', text: '#E6EDF3' } },
    { label: 'Фиолетовая', colors: { background: '#151125', surface: '#221B36', accent: '#B794F6', text: '#F2ECFF' } },
    { label: 'Изумрудная', colors: { background: '#081B1A', surface: '#10302C', accent: '#42D6B5', text: '#E7FFF7' } },
]

const fields: { key: ColorKey; label: string }[] = [
    { key: 'background', label: 'Фон страницы' },
    { key: 'surface', label: 'Карточки и шапка' },
    { key: 'accent', label: 'Кнопки и акценты' },
    { key: 'text', label: 'Основной текст' },
]

function isHex(value: string) { return /^#[0-9a-fA-F]{6}$/.test(value) }

function contrastRatio(first: string, second: string) {
    const luminance = (hex: string) => {
        const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const light = Math.max(luminance(first), luminance(second))
    const dark = Math.min(luminance(first), luminance(second))
    return (light + 0.05) / (dark + 0.05)
}

interface Props { form: UseFormReturnType<TSubscriptionPageRawConfig> }

export function PageColorsBlockComponent({ form }: Props) {
    const initial = (form.getValues().brandingSettings as { pageColors?: PageColors }).pageColors
    const [colors, setColors] = useState<PageColors>({ ...presets[0].colors, ...initial })
    const [revision, setRevision] = useState(0)

    const selectPreset = (palette: PageColors) => {
        for (const key of Object.keys(palette) as ColorKey[]) {
            form.setFieldValue(`brandingSettings.pageColors.${key}`, palette[key])
        }
        setColors({ ...palette })
        setRevision(value => value + 1)
    }

    const lowContrast = isHex(colors.text) && isHex(colors.surface) && contrastRatio(colors.text, colors.surface) < 4.5

    return <Card className={styles.sectionCard} p="lg" radius="lg">
        <Stack gap="md">
            <BaseOverlayHeader
                iconColor="cyan"
                IconComponent={IconPalette}
                iconSize={20}
                iconVariant="soft"
                subtitle="Настройка внешнего вида страницы подписки"
                title="Цветовая схема Subpage"
                titleOrder={5}
            />
            <Divider className={styles.divider} />
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
                <Stack gap="md">
                    <Group gap="xs">
                        {presets.map(preset => {
                            const active = fields.every(field => colors[field.key].toLowerCase() === preset.colors[field.key].toLowerCase())
                            return <Button
                                key={preset.label}
                                variant={active ? 'light' : 'default'}
                                leftSection={<span className={styles.themeSwatch} style={{ background: preset.colors.accent }} />}
                                rightSection={active ? <IconCheck size={15} /> : undefined}
                                onClick={() => selectPreset(preset.colors)}
                            >{preset.label}</Button>
                        })}
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        {fields.map(({ key, label }) => {
                            const path = `brandingSettings.pageColors.${key}`
                            return <ColorInput
                                key={`${form.key(path)}-${revision}`}
                                label={label}
                                format="hex"
                                swatches={presets.map(preset => preset.colors[key])}
                                {...form.getInputProps(path)}
                                defaultValue={colors[key]}
                                onChange={value => {
                                    form.setFieldValue(path, value)
                                    if (isHex(value)) setColors(current => ({ ...current, [key]: value }))
                                }}
                            />
                        })}
                    </SimpleGrid>
                    {lowContrast && <Text size="xs" c="yellow">Текст сливается с карточками. Выберите более контрастные цвета.</Text>}
                    <Text size="xs" c="dimmed">Сохраните конфигурацию и обновите страницу подписки, чтобы увидеть изменения.</Text>
                </Stack>
                <div className={styles.themePreview} style={{ background: colors.background, color: colors.text }}>
                    <Text size="xs" fw={700} style={{ color: colors.accent }} tt="uppercase">Предпросмотр</Text>
                    <div className={styles.themePreviewCard} style={{ background: colors.surface }}>
                        <Group justify="space-between" gap="xs">
                            <Text fw={700}>Ваша подписка</Text>
                            <ThemeIcon color={colors.accent} variant="light" radius="xl" size={28}><IconCheck size={16} /></ThemeIcon>
                        </Group>
                        <Text size="sm" mt="xs" style={{ opacity: 0.75 }}>Трафик: 18 ГиБ из 50 ГиБ</Text>
                        <div className={styles.themePreviewTrack} style={{ background: colors.background }}>
                            <span style={{ background: colors.accent, width: '36%' }} />
                        </div>
                    </div>
                </div>
            </SimpleGrid>
        </Stack>
    </Card>
}
