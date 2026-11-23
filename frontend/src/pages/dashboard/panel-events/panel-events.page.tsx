import {
    Alert, Badge, Button, Card, Center, Group, Select, SimpleGrid, Skeleton, Stack,
    Switch, Text, ThemeIcon, Title
} from '@mantine/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { TbBell, TbBellCheck, TbCheck, TbRefresh, TbSettings } from 'react-icons/tb'
import { Link, useLocation } from 'react-router'

import { instance } from '@shared/api/axios'
import {
    apiError, EVENTS_API, eventDate, eventQueryKeys, eventTypes, type EventsResult,
    useEventSummary, useMarkEventsRead
} from '@shared/api/panel-events'
import { Page } from '@shared/ui'

const severities = {
    info: { label: 'Информация', color: 'cyan' },
    warning: { label: 'Внимание', color: 'yellow' },
    critical: { label: 'Критическое', color: 'red' }
}

export function PanelEventsPage() {
    const [type, setType] = useState<string | null>(null)
    const [severity, setSeverity] = useState<string | null>(null)
    const [unread, setUnread] = useState(false)
    const summary = useEventSummary()
    const markRead = useMarkEventsRead()
    const location = useLocation()
    const entered = useRef('')
    const events = useInfiniteQuery({
        queryKey: [...eventQueryKeys.all, 'list', type, severity, unread],
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => (await instance.get<{ response: EventsResult }>(EVENTS_API, {
            params: { limit: 50, before: pageParam || undefined, type: type || undefined,
                severity: severity || undefined, unread: unread || undefined }
        })).data.response,
        getNextPageParam: last => last.nextCursor || undefined,
        staleTime: 10_000
    })

    useEffect(() => {
        if (entered.current === location.key) return
        const captured = (location.state as { readThrough?: string } | null)?.readThrough
        if (!captured && !summary.data) return
        entered.current = location.key
        if (captured || summary.data?.unreadCount) markRead.mutate(captured || summary.data!.latestSequence)
    }, [summary.data, markRead.mutate, location.key, location.state])

    const rows = events.data?.pages.flatMap(page => page.items) || []

    return <Page title="События"><Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
            <Group gap="sm"><ThemeIcon size={48} radius="md" variant="light" color="cyan"><TbBell size={26} /></ThemeIcon>
                <div><Title order={2}>События</Title><Text size="sm" c="dimmed">Важные уведомления инфраструктуры в одном журнале</Text></div>
            </Group>
            <Button h={44} component={Link} to="/dashboard/management/settings#notifications" variant="light" leftSection={<TbSettings size={18} />}>Настройки уведомлений</Button>
        </Group>

        <Card withBorder radius="md" p="lg"><Stack gap="md">
            <Group justify="space-between" wrap="wrap">
                <Group gap="xs"><Text fw={600}>Журнал панели</Text><Badge color={summary.data?.unreadCount ? 'cyan' : 'gray'} variant="light" aria-live="polite">{summary.data?.unreadCount || 0} новых</Badge></Group>
                <Group gap="xs"><Button h={44} variant="subtle" leftSection={<TbRefresh size={18} />} loading={events.isFetching && !events.isFetchingNextPage} onClick={() => { void events.refetch(); void summary.refetch() }}>Обновить</Button>
                    <Button h={44} variant="light" leftSection={<TbCheck size={18} />} disabled={!summary.data?.unreadCount} loading={markRead.isPending} onClick={() => summary.data && markRead.mutate(summary.data.latestSequence)}>Отметить прочитанными</Button>
                </Group>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select label="Тип события" placeholder="Все типы" data={eventTypes} searchable clearable value={type} onChange={setType} />
                <Select label="Важность" placeholder="Любая" clearable value={severity} onChange={setSeverity} data={Object.entries(severities).map(([value, entry]) => ({ value, label: entry.label }))} />
            </SimpleGrid>
            <Switch label="Только непрочитанные" checked={unread} onChange={event => setUnread(event.currentTarget.checked)} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
        </Stack></Card>

        {markRead.isError && <Alert color="red" title="Не удалось обновить счётчик">{apiError(markRead.error, 'Повторите попытку. События сохранены.')}</Alert>}
        {events.isError && <Alert color="red" title="Не удалось загрузить события"><Stack gap="sm"><Text size="sm">{apiError(events.error, 'Проверьте соединение и повторите попытку.')}</Text><Button variant="light" color="red" onClick={() => void events.refetch()}>Повторить</Button></Stack></Alert>}
        {events.isPending ? <Stack gap="md">{[1, 2, 3].map(id => <Skeleton key={id} h={130} radius="md" />)}</Stack> : rows.length ?
            <Stack gap="sm" aria-label="Журнал событий">
                {rows.map(event => <Card key={event.id} withBorder radius="md" p="lg" data-event-id={event.id}>
                    <Stack gap="sm"><Group justify="space-between" align="flex-start" wrap="wrap">
                        <Group gap="xs" wrap="wrap"><Badge variant="light" color={severities[event.severity]?.color || 'gray'}>{severities[event.severity]?.label || event.severity}</Badge><Text size="xs" c="dimmed">{eventTypes.find(item => item.value === event.type)?.label || event.type}</Text></Group>
                        <Text component="time" dateTime={event.occurredAt} size="xs" c="dimmed">{eventDate(event.occurredAt)}</Text>
                    </Group>
                        <Title order={4} style={{ overflowWrap: 'anywhere' }}>{event.title}</Title>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.message}</Text>
                        {event.nodeName && <Text size="xs" c="dimmed">Нода: {event.nodeName}</Text>}
                    </Stack>
                </Card>)}
                {events.hasNextPage && <Center><Button h={44} variant="light" loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Показать ещё</Button></Center>}
            </Stack> : !events.isError && <Card withBorder radius="md" p="xl"><Stack align="center" gap="sm" py="xl"><ThemeIcon size={64} radius="xl" variant="light" color="teal"><TbBellCheck size={30} /></ThemeIcon><Title order={3}>{unread ? 'Всё прочитано' : type || severity ? 'События не найдены' : 'Событий пока нет'}</Title><Text c="dimmed" ta="center" maw={500}>{type || severity ? 'Попробуйте изменить фильтры.' : 'Здесь появятся уведомления о состоянии нод, автоматизациях, оплате, сертификатах и нагрузке.'}</Text></Stack></Card>}
        <Text size="xs" c="dimmed">Открытие раздела сбрасывает счётчик новых событий. История остаётся в журнале.</Text>
    </Stack></Page>
}
