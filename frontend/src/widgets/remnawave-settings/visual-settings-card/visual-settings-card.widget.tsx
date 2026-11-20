import { Button, ColorInput, Divider, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { TbLayoutNavbar, TbLayoutSidebar } from 'react-icons/tb'

import { useIsMobile } from '@shared/hooks'
import { DEFAULT_COLORS, useAppearance } from '@shared/theme-customization/theme-customization'
import { SettingsCardShared } from '@shared/ui/settings-card'

import {
    LAYOUT_STYLE,
    useLayoutStyle,
    useToggleLayoutStyleAction
} from '@entities/dashboard/view-preferences-store'

export const VisualSettingsCardWidget = () => {
    const { t } = useTranslation()

    const isMobile = useIsMobile()

    const layoutStyle = useLayoutStyle()
    const toggleLayoutStyle = useToggleLayoutStyleAction()
    const { colors, setColors, reset } = useAppearance()

    return (
        <SettingsCardShared.Container>
            <SettingsCardShared.Header
                description="Расположение меню, цветовой акцент и фон интерфейса. Изменения сохраняются в этом браузере."
                icon={<TbLayoutSidebar size={24} />}
                iconColor="cyan"
                iconVariant="soft"
                title="Стиль оформления"
            />

            <SettingsCardShared.Content>
                <Stack gap="md">
                    {!isMobile && <SegmentedControl
                        data={[
                            {
                                label: (
                                    <Group gap="xs" justify="center" wrap="nowrap">
                                        <TbLayoutNavbar size={18} />
                                        <span>{t('visual-settings-card.widget.compact')}</span>
                                    </Group>
                                ),
                                value: LAYOUT_STYLE.COMPACT
                            },
                            {
                                label: (
                                    <Group gap="xs" justify="center" wrap="nowrap">
                                        <TbLayoutSidebar size={18} />
                                        <span>{t('visual-settings-card.widget.sidebar')}</span>
                                    </Group>
                                ),
                                value: LAYOUT_STYLE.SIDEBAR
                            }
                        ]}
                        fullWidth
                        onChange={() => toggleLayoutStyle()}
                        value={layoutStyle}
                    />}
                    <Divider label="Персонализация цветов" labelPosition="left" />
                    <Text c="dimmed" size="sm">Подберите цвета для панели. Для текста рекомендуется сохранять контрастность не менее 4,5:1.</Text>
                    <ColorInput label="Акцентный цвет" format="hex" value={colors.accent} onChange={(accent)=>setColors({...colors,accent})} swatches={['#06b6d4','#14b8a6','#8b5cf6','#e85656','#f59e0b','#3b82f6']} description="Кнопки, активные пункты и выделения" />
                    <ColorInput label="Цвет фона" format="hex" value={colors.background} onChange={(background)=>setColors({...colors,background})} swatches={['#0d1117','#09090b','#111827','#17212b','#f8fafc']} description="Основная рабочая область" />
                    <ColorInput label="Цвет карточек, меню и верхней панели" format="hex" value={colors.surface} onChange={(surface)=>setColors({...colors,surface})} swatches={['#161b22','#1c1c24','#21262d','#263040','#ffffff']} description="Верхняя строка и боковое меню теперь окрашиваются согласованно. Акцентный цвет не изменяет их фон." />
                    <Group justify="space-between" wrap="wrap"><Text size="xs" c="dimmed">Настройки применяются сразу и хранятся локально.</Text><Button variant="light" color="gray" onClick={reset} disabled={Object.keys(DEFAULT_COLORS).every((key)=>colors[key as keyof typeof colors]===DEFAULT_COLORS[key as keyof typeof colors])}>Сбросить цвета</Button></Group>
                </Stack>
            </SettingsCardShared.Content>
        </SettingsCardShared.Container>
    )
}
