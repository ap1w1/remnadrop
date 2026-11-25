import {
    NodeSelectItem,
    NodeSelectItemProps
} from '@features/dashboard/users/users-table/model/node-select-item'
import { MRT_ColumnDef } from '@kastov/mantine-react-table-open'
import { Group, Text } from '@mantine/core'
import { GetAllNodesCommand, GetTorrentBlockerReportsCommand } from '@remnawave/backend-contract'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CountryFlag } from '@shared/ui/get-country-flag'
import { formatTimeUtil } from '@shared/utils/time-utils'

export const useTbReportsTableColumns = (nodes?: GetAllNodesCommand.Response['response']) => {
    const { t, i18n } = useTranslation()

    return useMemo<
        MRT_ColumnDef<GetTorrentBlockerReportsCommand.Response['response']['records'][number]>[]
    >(
        () => [
            {
                id:'device',header:'Device',enableSorting:false,enableColumnFilter:false,size:320,
                Cell:({row})=>{
                    const report=row.original.report as typeof row.original.report & {
                        knownDeviceCount?:number
                        knownDevices?:{hwid:string;platform:string|null;model:string|null;userAgent:string|null}[]
                        subscriptionClient?:{userAgent:string}|null
                    }
                    const d=report.device
                    if(d)return <div><Text size="sm">{[d.platform,d.model].filter(Boolean).join(' · ')||'Модель не указана'}</Text><Text size="xs">HWID: {d.hwid}</Text><Text size="xs" style={{overflowWrap:'anywhere'}}>{d.userAgent??'User-Agent не указан'}</Text><Text size="xs" c="yellow">Вероятное совпадение по IP</Text></div>
                    if(report.subscriptionClient)return <div><Text size="sm" style={{overflowWrap:'anywhere'}}>{report.subscriptionClient.userAgent}</Text><Text size="xs" c="yellow">Клиент подписки с того же IP · HWID не определён</Text>{!!report.knownDeviceCount&&<Text size="xs" c="dimmed">Известных HWID: {report.knownDeviceCount}</Text>}</div>
                    if(report.knownDeviceCount){const known=report.knownDevices?.[0];return <div><Text size="sm">{report.knownDeviceCount===1?[known?.platform,known?.model].filter(Boolean).join(' · ')||'Одно устройство':`Устройств пользователя: ${report.knownDeviceCount}`}</Text>{report.knownDeviceCount===1&&known&&<Text size="xs">HWID: {known.hwid}</Text>}<Text size="xs" c="dimmed" title={report.knownDevices?.map(device=>[device.platform,device.model,device.hwid].filter(Boolean).join(' · ')).join('; ')}>Связь с подключением не подтверждена</Text></div>}
                    return <Text size="sm" c="dimmed">Нет данных HWID или клиента</Text>
                }
            },
            {
                accessorKey: 'user.username',
                header: 'Username',
                accessorFn: (originalRow) => {
                    if (originalRow.user && originalRow.user.username) {
                        return originalRow.user.username
                    }
                    return '–'
                },
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            },
            {
                accessorKey: 'node.uuid',
                header: 'Reported Node',
                Cell: ({ cell }) => (
                    <Group
                        align="center"
                        gap="sm"
                        style={{
                            flex: 1,
                            minWidth: 0
                        }}
                        wrap="nowrap"
                    >
                        <CountryFlag countryCode={cell.row.original.node?.countryCode} />
                        <Text ff="monospace" fw={500} size="md">
                            {cell.row.original.node?.name || '–'}
                        </Text>
                    </Group>
                ),
                filterVariant: 'select',
                mantineFilterSelectProps: {
                    comboboxProps: {
                        transitionProps: { transition: 'fade', duration: 200 }
                    },
                    checkIconPosition: 'left',
                    data:
                        nodes?.map((node) => ({
                            label: `${node.name}${node.address ? ` · ${node.address}` : ''}`,
                            value: node.uuid,
                            countryCode: node.countryCode
                        })) ?? [],
                    renderOption: (item) => {
                        const option = item.option as NodeSelectItemProps
                        return <NodeSelectItem {...option} />
                    }
                },
                enableSorting: false,
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            },
            {
                accessorKey: 'report.actionReport.ip',
                header: 'IP',
                accessorFn: (originalRow) => {
                    if (
                        originalRow.report &&
                        originalRow.report.actionReport &&
                        originalRow.report.actionReport.ip
                    ) {
                        return originalRow.report.actionReport.ip
                    }
                    return '–'
                },

                enableSorting: false,
                enableColumnFilterModes: false,
                enableColumnFilter: true,
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            },
            {
                accessorKey: 'report.xrayReport.inboundTag',
                header: 'Inbound Tag',
                accessorFn: (originalRow) => {
                    if (
                        originalRow.report &&
                        originalRow.report.xrayReport &&
                        originalRow.report.xrayReport.inboundTag
                    ) {
                        return originalRow.report.xrayReport.inboundTag
                    }
                    return '–'
                },

                enableSorting: false,
                enableColumnFilterModes: false,
                enableColumnFilter: true,
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            },

            {
                accessorKey: 'createdAt',
                header: t('use-hwid-inspector-table-columns.created-at'),
                accessorFn: (originalRow) =>
                    formatTimeUtil({
                        time: originalRow.createdAt,
                        template: 'TIME_FIRST_DATETIME',
                        language: i18n.language
                    }),
                minSize: 250,
                enableColumnFilterModes: false,
                enableColumnFilter: false,

                mantineTableBodyCellProps: {
                    align: 'center',
                    ff: 'monospace'
                }
            },

            {
                accessorKey: 'report.xrayReport.outboundTag',
                header: 'Outbound Tag',
                accessorFn: (originalRow) => {
                    if (
                        originalRow.report &&
                        originalRow.report.xrayReport &&
                        originalRow.report.xrayReport.outboundTag
                    ) {
                        return originalRow.report.xrayReport.outboundTag
                    }
                    return '–'
                },
                size: 300,

                enableSorting: false,
                enableColumnFilterModes: false,
                enableColumnFilter: true,
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            },

            {
                accessorKey: 'report.xrayReport.protocol',
                header: 'Protocol',
                accessorFn: (originalRow) => {
                    if (
                        originalRow.report &&
                        originalRow.report.xrayReport &&
                        originalRow.report.xrayReport.protocol
                    ) {
                        return originalRow.report.xrayReport.protocol
                    }
                    return '–'
                },

                enableSorting: false,
                enableColumnFilterModes: false,
                enableColumnFilter: true,
                mantineTableBodyCellProps: {
                    align: 'center'
                }
            }
        ],
        [nodes, t, i18n.language]
    )
}
