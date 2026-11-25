import { BoxProps, Group } from '@mantine/core'

import { LanguageControl } from './LanguageControl'
import { EventsControl } from './EventsControl'
import { LogoutControl } from './LogoutControl'
import { SupportControl } from './SupportControl'
import { TelegramControl } from './TelegramControl'
import { VersionControl } from './VersionControl'

interface HeaderControlsProps extends BoxProps {
    githubLink?: string
    isGithubLoading?: boolean
    stars?: number
    telegramLink: string
    withGithub?: boolean
    withLanguage?: boolean
    withLogout?: boolean
    withPrime?: boolean
    withSupport?: boolean
    withTelegram?: boolean
    withVersion?: boolean
    withEvents?: boolean
}

export function HeaderControls({
    githubLink,
    withGithub = true,
    withTelegram = true,
    withSupport = true,
    withLogout = true,
    withLanguage = true,
    withVersion = true,
    withPrime = false,
    withEvents = false,
    telegramLink,
    stars,
    isGithubLoading,
    ...others
}: HeaderControlsProps) {
    return (
        <Group gap="xs" {...others}>
            {withEvents && <EventsControl />}
            {withTelegram && <TelegramControl link={telegramLink} />}
            {withSupport && <SupportControl />}

            {withVersion && <VersionControl />}
            {withLanguage && <LanguageControl />}
            {withLogout && <LogoutControl />}
        </Group>
    )
}
