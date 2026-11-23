import {
    Alert,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Paper,
    Select,
    Stack,
    Text,
    ThemeIcon
} from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { TbBell, TbCheck, TbRefresh, TbSettings } from 'react-icons/tb'
import { Link } from 'react-router'

import { EVENT_LABELS, errorMessage, getEvents, useReadEvents } from '@shared/api/panel-events'
import { Page, PageHeaderShared } from '@shared/ui'

const severityLabels = {
    info: 'Информация',
    warning: 'Внимание',
    error: 'Ошибка',
    success: 'Восстановление'
}
const colors = { info: 'blue', warning: 'orange', error: 'red', success: 'teal' }

export function EventsPage() {
    const [type, setType] = useState<string | null>(null)
    const [severity, setSeverity] = useState<string | null>(null)
    const firstRead = useRef(false)
    const read = useReadEvents()
    const events = useInfiniteQuery({
        queryKey: ['panel-events', 'history', type, severity],
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) =>
            getEvents({
                before: pageParam,
                type: type || undefined,
                severity: severity || undefined
            }),
        getNextPageParam: (page) => (page.items.length === 50 ? page.items.at(-1)?.id : undefined),
        refetchInterval: 15000
    })
    const latestId = events.data?.pages[0].latestId
    useEffect(() => {
        if (latestId && !firstRead.current) {
            firstRead.current = true
            read.mutate(latestId)
        }
    }, [latestId])
    const items = events.data?.pages.flatMap((page) => page.items) || []
    return (
        <Page title="События">
            <PageHeaderShared icon={<TbBell size={24} />} title="События" />
            <Stack gap="lg">
                <Group justify="space-between">
                    <Text c="dimmed" maw={650}>
                        Важные уведомления панели: состояние нод, автоматизации, оплата, сертификаты
                        и нагрузка.
                    </Text>
                    <Group>
                        <Button
                            variant="default"
                            component={Link}
                            to="/dashboard/management/settings"
                            leftSection={<TbSettings size={16} />}
                        >
                            Настроить уведомления
                        </Button>
                        <Button
                            variant="light"
                            leftSection={<TbCheck size={16} />}
                            loading={read.isPending}
                            disabled={!latestId}
                            onClick={() => latestId && read.mutate(latestId)}
                        >
                            Отметить прочитанными
                        </Button>
                    </Group>
                </Group>
                <Paper withBorder p="md" radius="md">
                    <Group align="end">
                        <Select
                            label="Тип события"
                            placeholder="Все типы"
                            clearable
                            value={type}
                            onChange={setType}
                            w={280}
                            data={Object.entries(EVENT_LABELS).map(([value, label]) => ({
                                value,
                                label
                            }))}
                        />
                        <Select
                            label="Важность"
                            placeholder="Все события"
                            clearable
                            value={severity}
                            onChange={setSeverity}
                            w={210}
                            data={Object.entries(severityLabels).map(([value, label]) => ({
                                value,
                                label
                            }))}
                        />
                        <Button
                            variant="subtle"
                            leftSection={<TbRefresh size={16} />}
                            loading={events.isFetching && !events.isFetchingNextPage}
                            onClick={() => void events.refetch()}
                        >
                            Обновить
                        </Button>
                    </Group>
                </Paper>
                {(events.isError || read.isError) && (
                    <Alert color="red" title="Не удалось обновить события">
                        {errorMessage(events.error || read.error)}
                    </Alert>
                )}
                {events.isLoading ? (
                    <Center p="xl">
                        <Loader />
                    </Center>
                ) : items.length === 0 ? (
                    <Paper withBorder p="xl" ta="center">
                        <ThemeIcon variant="light" size={56} radius="xl">
                            <TbBell size={28} />
                        </ThemeIcon>
                        <Text fw={600} mt="md">
                            {type || severity
                                ? 'Нет событий по выбранным фильтрам'
                                : 'Пока нет событий'}
                        </Text>
                        <Text c="dimmed" size="sm" mt="xs">
                            Новые уведомления появятся здесь автоматически.
                        </Text>
                    </Paper>
                ) : (
                    <Stack gap="sm">
                        {items.map((event) => (
                            <Paper key={event.id} withBorder p="md" radius="md">
                                <Group align="start" wrap="nowrap">
                                    <ThemeIcon
                                        color={colors[event.severity]}
                                        variant="light"
                                        size={40}
                                        radius="md"
                                    >
                                        <TbBell size={20} />
                                    </ThemeIcon>
                                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                                        <Group justify="space-between">
                                            <Text fw={600}>{event.title}</Text>
                                            <Badge color={colors[event.severity]} variant="light">
                                                {severityLabels[event.severity]}
                                            </Badge>
                                        </Group>
                                        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                                            {event.message}
                                        </Text>
                                        <Group gap="xs">
                                            <Text c="dimmed" size="xs">
                                                {new Date(event.createdAt).toLocaleString()}
                                            </Text>
                                            <Text c="dimmed" size="xs">
                                                · {EVENT_LABELS[event.type] || event.type}
                                            </Text>
                                            {event.type.startsWith('ssl.') && (
                                                <Button
                                                    size="compact-xs"
                                                    variant="subtle"
                                                    component={Link}
                                                    to="/dashboard/management/ssl-certificates"
                                                >
                                                    Сертификаты
                                                </Button>
                                            )}
                                            {event.type.startsWith('automation.') && (
                                                <Button
                                                    size="compact-xs"
                                                    variant="subtle"
                                                    component={Link}
                                                    to="/dashboard/management/automations"
                                                >
                                                    Автоматизации
                                                </Button>
                                            )}
                                        </Group>
                                    </Stack>
                                </Group>
                            </Paper>
                        ))}
                    </Stack>
                )}
                {events.hasNextPage && (
                    <Button
                        variant="default"
                        loading={events.isFetchingNextPage}
                        onClick={() => void events.fetchNextPage()}
                    >
                        Загрузить ещё
                    </Button>
                )}
            </Stack>
        </Page>
    )
}
