import { Group, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import clsx from 'clsx'

import { useGetRemnawaveMetadata } from '@shared/api/hooks'


import { Logo } from '../logo'
import { BaseOverlayHeader } from '../overlays/base-overlay-header'
import { BuildInfoModal } from '../sidebar/build-info-modal'
import { HeaderControl } from './HeaderControl'
import { SkeletonHeaderControl } from './SkeletonHeaderControl'
import classes from './VersionControl.module.css'

export function VersionControl() {
    const { data: remnawaveMetadata, isLoading } = useGetRemnawaveMetadata()

    const isDev = remnawaveMetadata?.git.backend.branch === 'dev'

    if (isLoading || !remnawaveMetadata) {
        return <SkeletonHeaderControl width={85} />
    }

    const handleClick = () => {
        modals.open({
            title: (
                <BaseOverlayHeader
                    iconColor="teal"
                    IconComponent={Logo}
                    iconVariant="soft"
                    title="Обновления RemnaDrop"
                />
            ),
            centered: true,
            size: 'md',
            withCloseButton: true,
            children: (
                <BuildInfoModal
                    remnawaveMetadata={remnawaveMetadata}
                />
            )
        })
    }

    return (
        <HeaderControl
            className={clsx(classes.version, {
                [classes.dev]: isDev
            })}
            onClick={handleClick}
            w="auto"
        >
            <Group gap={8} ml={10} mr={10} wrap="nowrap">
                <Logo size={20} />
                <Text ff="text" fw={600} size="sm">
                    RemnaDrop
                </Text>
            </Group>
        </HeaderControl>
    )
}
