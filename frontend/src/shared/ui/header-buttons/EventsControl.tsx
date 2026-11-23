import { Badge, Button, Tooltip } from '@mantine/core'
import { useEffect } from 'react'
import { TbBell } from 'react-icons/tb'
import { useNavigate } from 'react-router'

import { useEventFeed, useNotificationPreferences, useReadEvents } from '@shared/api/panel-events'
import { showNewEvents } from '@shared/notifications/browser-notifications'

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
            <Button
                variant="light"
                color={feed.isError ? 'orange' : 'cyan'}
                h={40}
                px="sm"
                leftSection={<TbBell size={19} />}
                aria-label={`События, непрочитанных: ${count}`}
                onClick={() => {
                    if (feed.data) read.mutate(feed.data.latestId)
                    navigate('/dashboard/events')
                }}
                rightSection={
                    count > 0 ? (
                        <Badge size="sm" variant="filled" circle>
                            {count > 99 ? '99+' : count}
                        </Badge>
                    ) : undefined
                }
            >
                События
            </Button>
        </Tooltip>
    )
}
