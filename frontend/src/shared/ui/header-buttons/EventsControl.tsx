import { Badge, Button, Text, Tooltip } from '@mantine/core'
import { TbBell } from 'react-icons/tb'
import { useNavigate } from 'react-router'

import { EVENTS_PATH, useEventSummary } from '@shared/api/panel-events'

export function EventsControl() {
    const navigate = useNavigate()
    const summary = useEventSummary()
    const count = summary.data?.unreadCount || 0

    return <Tooltip label={summary.isError ? 'Не удалось обновить счётчик. Откройте журнал, чтобы повторить.' : 'Открыть журнал событий'}>
        <Button h={44} variant="subtle" color="cyan" px="sm" data-testid="header-events"
            leftSection={<TbBell size={21} />} aria-label={`События: ${count} новых`}
            onClick={() => {
                navigate(EVENTS_PATH, { state: { readThrough: summary.data?.latestSequence } })
            }}>
            <Text component="span" size="sm" visibleFrom="sm">События</Text>
            <Badge ml={6} size="sm" color={summary.isError ? 'gray' : count ? 'cyan' : 'gray'} variant="filled" aria-hidden>{summary.isError ? '—' : count > 99 ? '99+' : count}</Badge>
        </Button>
    </Tooltip>
}
