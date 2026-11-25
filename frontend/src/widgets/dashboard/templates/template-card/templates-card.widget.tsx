import { CopyButton, Menu } from '@mantine/core'
import { GetSubscriptionTemplateCommand, GetSubscriptionTemplatesCommand } from '@remnawave/backend-contract'
import { notifications } from '@mantine/notifications'
import { decode } from '@stablelib/base64'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PiCheck, PiCopy, PiPencil, PiTrashDuotone } from 'react-icons/pi'
import { TbDownload, TbEdit } from 'react-icons/tb'
import { generatePath, useNavigate } from 'react-router'

import { ROUTES } from '@shared/constants'
import { instance } from '@shared/api'
import { WithDndSortable } from '@shared/hocs/with-dnd-sortable'
import { EntityCardShared } from '@shared/ui/entity-card'

import { MODALS, useModalsStoreOpenWithData } from '@entities/dashboard/modal-store'

interface IProps {
    handleDeleteTemplate: (templateUuid: string) => void
    isDragOverlay?: boolean
    template: GetSubscriptionTemplatesCommand.Response['response']['templates'][number]
    templateTitle: string
    themeLogo: ReactNode
}

export function TemplatesCardWidget(props: IProps) {
    const {
        template,
        templateTitle,
        themeLogo,
        handleDeleteTemplate,
        isDragOverlay = false
    } = props

    const { t } = useTranslation()

    const openModalWithData = useModalsStoreOpenWithData()

    const navigate = useNavigate()

    return (
        <WithDndSortable
            dragHandlePosition="top-right"
            id={template.uuid}
            isDragOverlay={isDragOverlay}
        >
            <EntityCardShared.Root withTopAccent={template.name === 'Default'}>
                <EntityCardShared.Header>
                    <EntityCardShared.Icon
                        highlight={template.name === 'Default'}
                        onClick={() =>
                            navigate(
                                generatePath(ROUTES.DASHBOARD.TEMPLATES.TEMPLATE_EDITOR, {
                                    type: template.templateType,
                                    uuid: template.uuid
                                })
                            )
                        }
                    >
                        {themeLogo}
                    </EntityCardShared.Icon>
                    <EntityCardShared.Content subtitle={templateTitle} title={template.name} />
                </EntityCardShared.Header>

                <EntityCardShared.Actions>
                    <EntityCardShared.Button
                        leftSection={<TbEdit size={16} />}
                        onClick={() =>
                            navigate(
                                generatePath(ROUTES.DASHBOARD.TEMPLATES.TEMPLATE_EDITOR, {
                                    type: template.templateType,
                                    uuid: template.uuid
                                })
                            )
                        }
                    >
                        {t('common.edit')}
                    </EntityCardShared.Button>
                    <EntityCardShared.Menu>
                        <Menu.Item
                            leftSection={<TbDownload size={18} />}
                            onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                    const response = await instance.get(GetSubscriptionTemplateCommand.url(template.uuid))
                                    const { response: fullTemplate } = GetSubscriptionTemplateCommand.ResponseSchema.parse(response.data)
                                    const content = fullTemplate.templateJson ?? (fullTemplate.encodedTemplateYaml
                                        ? { name: fullTemplate.name, templateType: fullTemplate.templateType,
                                            templateYaml: new TextDecoder().decode(decode(fullTemplate.encodedTemplateYaml)) }
                                        : null)
                                    if (content === null) throw new Error('Содержимое шаблона отсутствует')
                                    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }))
                                    const link = document.createElement('a')
                                    link.href = url
                                    link.download = `${template.name.replace(/[\\/:*?"<>|]/g, '_')}.json`
                                    document.body.appendChild(link)
                                    link.click()
                                    link.remove()
                                    URL.revokeObjectURL(url)
                                } catch {
                                    notifications.show({ color: 'red', message: 'Не удалось скачать содержимое шаблона' })
                                }
                            }}
                        >
                            Скачать JSON
                        </Menu.Item>
                        <CopyButton timeout={2000} value={template.uuid}>
                            {({ copied, copy }) => (
                                <Menu.Item
                                    color={copied ? 'teal' : undefined}
                                    leftSection={
                                        copied ? <PiCheck size={18} /> : <PiCopy size={18} />
                                    }
                                    onClick={copy}
                                >
                                    {t('common.copy-uuid')}
                                </Menu.Item>
                            )}
                        </CopyButton>

                        <Menu.Item
                            disabled={template.name === 'Default'}
                            leftSection={<PiPencil size={18} />}
                            onClick={() => {
                                openModalWithData(MODALS.RENAME_SQUAD_OR_CONFIG_PROFILE_MODAL, {
                                    name: template.name,
                                    uuid: template.uuid
                                })
                            }}
                        >
                            {t('common.rename')}
                        </Menu.Item>

                        <Menu.Item
                            color="red"
                            disabled={template.name === 'Default'}
                            leftSection={<PiTrashDuotone size={18} />}
                            onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteTemplate(template.uuid)
                            }}
                        >
                            {t('common.delete')}
                        </Menu.Item>
                    </EntityCardShared.Menu>
                </EntityCardShared.Actions>
            </EntityCardShared.Root>
        </WithDndSortable>
    )
}
