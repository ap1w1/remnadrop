import { Badge, Tooltip } from '@mantine/core'
import { useEffect } from 'react'
import { TbBell } from 'react-icons/tb'
import { useNavigate } from 'react-router'

import { useEventFeed, useNotificationPreferences, useReadEvents } from '@shared/api/panel-events'
import { showNewEvents } from '@shared/notifications/browser-notifications'
import { HeaderControl } from './HeaderControl'

export function EventsControl() {
    const feed = useEventFeed()
    const preferences = useNotificationPreferences()
    const read = useReadEvents()
    const navigate = useNavigate()
    useEffect(() => {
        if (feed.data && preferences.data)
            void showNewEvents(feed.data, preferences.data).catch(() => {})
    }, [feed.data, preferences.data])
    const count = feed.data?.unread ?? 0
    return (
        <Tooltip
            label={
                feed.isError ? 'Не удалось загрузить события' : `Непрочитанных событий: ${count}`
            }
        >
            <HeaderControl
                aria-label={`События, непрочитанных: ${count}`}
                onClick={() => {
                    if (feed.data) read.mutate(feed.data.latestId)
                    navigate('/dashboard/events')
                }}
            >
                <TbBell size={22} />
                {count > 0 && <Badge size="xs" circle pos="absolute" top={-4} right={-4}>{count > 9 ? '9+' : count}</Badge>}
            </HeaderControl>
        </Tooltip>
    )
}
