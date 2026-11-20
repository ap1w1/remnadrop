import { Box, Center, Code, Drawer, Stack, Title, Typography } from '@mantine/core'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TbAlertCircle, TbQuestionMark } from 'react-icons/tb'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'

import { MODALS, useModalClose, useModalState } from '@entities/dashboard/modal-store'

import { LoaderModalShared } from '../loader-modal'
import { BaseOverlayHeader } from '../overlays/base-overlay-header'
import classes from './help-drawer.module.css'
import { THelpDrawerAvailableScreen } from './help-drawer.types'

const REMNADROP_BACKUP_HELP = "# Бэкапы RemnaDrop\n\n## Что сохраняется\nАрхив содержит базу PostgreSQL: пользователей и настройки панели. Конфигурация Docker, .env и TLS-ключи в архив не входят. Сохраните их отдельно.\n\n## 1. Включите копирование на VPS\nНа сервере форка установите службу:\n\n~~~bash\nsudo bash /opt/remnadrop-git/backup-agent/install-agent.sh\nsystemctl status remnadrop-backups.timer\n~~~\n\nСлужба проверяет расписания и создаёт дампы. Панели не передаются права Docker.\n\n## 2. Выберите хранилище\n**Локальное** работает без дополнительных подключений. Для **S3, SFTP или Google Drive** сначала подключите rclone на сервере:\n\n~~~bash\nsudo apt-get install -y rclone\nsudo install -d -m 700 /etc/remnadrop-backups\nsudo rclone --config /etc/remnadrop-backups/rclone.conf config\nsudo chmod 600 /etc/remnadrop-backups/rclone.conf\n~~~\n\nВ панели укажите только имя готового подключения (remote). Пароли туда не вводятся.\n\n## 3. Запустите первую копию\nСоздайте хранилище, выберите расписание (например, раз в сутки), срок хранения 7–30 дней, нажмите «Создать сейчас» и убедитесь, что в истории появилась запись.\n\n## Удаление и безопасность\nУдаление хранилища отключает расписание и скрывает его из списка, но **не удаляет архивы физически**. Перед восстановлением проверьте дамп через pg_restore --list и пробное восстановление в отдельную базу.\n\n## Полное восстановление панели\nКроме дампа PostgreSQL вам нужны сохранённые конфигурация Docker и секреты .env. Не восстанавливайте архив поверх рабочей базы без проверенной копии и плана отката."

const SUPPORTED_LANGUAGES = new Set(['en', 'fa', 'ru', 'zh'])

const resolveDocsUrl = (screen: THelpDrawerAvailableScreen, language: string) => {
    const lang = language.split('-')[0]
    const safeLang = SUPPORTED_LANGUAGES.has(lang) ? lang : 'en'
    return `https://raw.githubusercontent.com/remnawave/panel/refs/heads/main/_panel-docs/help-articles/${safeLang}/${screen}.md`
}

export const HelpDrawerShared = memo(() => {
    const { t, i18n } = useTranslation()

    const { isOpen, internalState } = useModalState(MODALS.HELP_DRAWER)
    const close = useModalClose(MODALS.HELP_DRAWER)

    const [content, setContent] = useState('')
    const [loading, setLoading] = useState(false)
    const [showContent, setShowContent] = useState(false)
    const [error, setError] = useState<null | string>(null)

    useEffect(() => {
        if (!isOpen || !internalState) {
            return
        }

        setError(null)
        if (internalState.screen === 'PAGE_BACKUPS') {
            setContent(REMNADROP_BACKUP_HELP)
            setLoading(false)
            setShowContent(true)
            return
        }

        setLoading(true)

        fetch(resolveDocsUrl(internalState.screen, i18n.language))
            .then((res) => {
                if (!res.ok) throw new Error(t('help-drawer.shared.failed-to-load-documentation'))
                return res.text()
            })
            .then((text) => {
                setContent(text)
            })
            .catch((err) => {
                setError(err.message)
                setLoading(false)
            })
            .finally(() => {
                setTimeout(() => {
                    setLoading(false)
                    setShowContent(true)
                }, 300)
            })
    }, [isOpen])

    const cleanContent = () => {
        setContent('')
        setShowContent(false)
        setLoading(false)
        setError(null)
    }

    return (
        <Drawer
            keepMounted={false}
            onClose={close}
            onExitTransitionEnd={cleanContent}
            opened={isOpen}
            overlayProps={{ backgroundOpacity: 0.6, blur: 0 }}
            position="right"
            size="lg"
            title={
                <BaseOverlayHeader
                    iconColor="yellow"
                    IconComponent={TbQuestionMark}
                    iconVariant="soft"
                    title={t('help-action-icon.shared.help-article')}
                />
            }
        >
            {loading && (
                <LoaderModalShared
                    h="80vh"
                    text={t('help-drawer.shared.loading-documentation')}
                    w="100%"
                />
            )}

            {error && (
                <Center h="80vh" w="100%">
                    <Stack align="center" gap="xs">
                        <TbAlertCircle color="var(--mantine-color-red-5)" size="4rem" />
                        <Title c="dimmed" order={4} size="lg">
                            {t('help-drawer.shared.failed-to-load-documentation')}
                        </Title>
                        <Code color="var(--mantine-color-red-light)">{error}</Code>
                    </Stack>
                </Center>
            )}

            <Box
                style={{
                    opacity: showContent ? 1 : 0,
                    pointerEvents: showContent ? 'auto' : 'none',
                    transition: 'opacity 0.3s ease'
                }}
            >
                {!loading && content && (
                    <Typography className={classes.root}>
                        <ReactMarkdown rehypePlugins={[rehypeRaw]} remarkPlugins={[remarkGfm]}>
                            {content}
                        </ReactMarkdown>
                    </Typography>
                )}
            </Box>
        </Drawer>
    )
})
