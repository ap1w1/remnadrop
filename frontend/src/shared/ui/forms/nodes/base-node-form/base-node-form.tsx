import { DeleteNodeFeature } from '@features/ui/dashboard/nodes/delete-node'
import { ResetNodeTrafficFeature } from '@features/ui/dashboard/nodes/reset-node-traffic'
import { RestartNodeButtonFeature } from '@features/ui/dashboard/nodes/restart-node-button'
import { ToggleNodeStatusButtonFeature } from '@features/ui/dashboard/nodes/toggle-node-status-button'
import { Button, CopyButton, Menu, px, SimpleGrid, Stack, Tabs } from '@mantine/core'
import { UseFormReturnType } from '@mantine/form'
import {
    GetNodePluginsCommand,
    GetOneNodeCommand,
    GetPubKeyCommand,
    UpdateNodeCommand
} from '@remnawave/backend-contract'
import { ModalAccordionWidget } from '@widgets/dashboard/nodes/modal-accordeon-widget'
import { motion } from 'framer-motion'
import { t } from 'i18next'
import { ReactNode } from 'react'
import { PiFloppyDiskDuotone } from 'react-icons/pi'
import { TbCopy, TbDots } from 'react-icons/tb'

import { useIsMobile } from '@shared/hooks'
import { ModalFooter } from '@shared/ui/modal-footer'

import { NodeConfigProfilesCard } from './node-config-profiles.card'
import { NodeConsumptionCard } from './node-consumption.card'
import { NodeTrackingAndBillingCard } from './node-tracking-and-billing.card'
import { NodeVitalsCard } from './node-vitals.card'
import { NodeIpPoolCard } from './node-ip-pool.card'

const MotionWrapper = motion.div
const MotionStack = motion.create(Stack)

const containerVariants = {
    hidden: {},
    visible: {
        transition: {
            staggerChildren: 0.1
        }
    }
}

const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3 }
    }
}

interface IProps<T extends UpdateNodeCommand.Request> {
    form: UseFormReturnType<T>
    handleClose: () => void
    handleSubmit: () => void
    isDataSubmitting: boolean
    node: GetOneNodeCommand.Response['response']
    nodeDetailsCard?: ReactNode
    nodePlugins: GetNodePluginsCommand.Response['response']['nodePlugins']
    nodeSystemCard?: ReactNode
    pubKey: GetPubKeyCommand.Response['response'] | undefined
}

export const BaseNodeForm = <T extends UpdateNodeCommand.Request>(props: IProps<T>) => {
    const {
        form,
        node,
        nodePlugins,
        pubKey,
        nodeDetailsCard,
        nodeSystemCard,
        handleClose,
        handleSubmit,
        isDataSubmitting
    } = props

    const isMobile = useIsMobile()

    return (
        <>
            <Tabs defaultValue="settings" keepMounted={false}>
                <Tabs.List mb="md">
                    <Tabs.Tab value="settings">Основные настройки</Tabs.Tab>
                    <Tabs.Tab value="ip">Управление IP</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="settings">
            {isMobile ? (
                <MotionStack
                    animate="visible"
                    gap="lg"
                    initial="hidden"
                    variants={containerVariants}
                >
                    <ModalAccordionWidget node={node} />

                    {nodeDetailsCard && (
                        <MotionWrapper variants={cardVariants}>{nodeDetailsCard}</MotionWrapper>
                    )}

                    {nodeSystemCard && node.system && (
                        <MotionWrapper variants={cardVariants}>{nodeSystemCard}</MotionWrapper>
                    )}

                    <NodeVitalsCard
                        cardVariants={cardVariants}
                        form={form}
                        motionWrapper={MotionWrapper}
                        nodePlugins={nodePlugins}
                        nodeUuid={node.uuid}
                        pubKey={pubKey}
                    />

                    <NodeConfigProfilesCard
                        cardVariants={cardVariants}
                        form={form}
                        motionWrapper={MotionWrapper}
                    />

                    <NodeTrackingAndBillingCard
                        cardVariants={cardVariants}
                        form={form}
                        motionWrapper={MotionWrapper}
                    />

                    <NodeConsumptionCard
                        cardVariants={cardVariants}
                        form={form}
                        motionWrapper={MotionWrapper}
                    />
                </MotionStack>
            ) : (
                <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" verticalSpacing="md" style={{ width: "100%", alignItems: "start" }}>
                    {/* Left Side */}
                    <MotionStack
                        animate="visible"
                        gap="md"
                        initial="hidden"
                        style={{ width: '100%', minWidth: 0 }}
                        variants={containerVariants}
                    >
                        <ModalAccordionWidget node={node} />

                        {nodeDetailsCard && (
                            <MotionWrapper variants={cardVariants}>{nodeDetailsCard}</MotionWrapper>
                        )}

                        <NodeVitalsCard
                            cardVariants={cardVariants}
                            form={form}
                            motionWrapper={MotionWrapper}
                            nodePlugins={nodePlugins}
                            nodeUuid={node.uuid}
                            pubKey={pubKey}
                        />

                        <NodeConsumptionCard
                            cardVariants={cardVariants}
                            form={form}
                            motionWrapper={MotionWrapper}
                        />
                    </MotionStack>

                    {/* Right Side */}
                    <MotionStack
                        animate="visible"
                        gap="md"
                        initial="hidden"
                        style={{ width: '100%', minWidth: 0 }}
                        variants={containerVariants}
                    >
                        {nodeSystemCard && node.system && (
                            <MotionWrapper variants={cardVariants}>{nodeSystemCard}</MotionWrapper>
                        )}

                        <NodeConfigProfilesCard
                            cardVariants={cardVariants}
                            form={form}
                            motionWrapper={MotionWrapper}
                        />

                        <NodeTrackingAndBillingCard
                            cardVariants={cardVariants}
                            form={form}
                            motionWrapper={MotionWrapper}
                        />
                        </MotionStack>
                </SimpleGrid>
            )}
                </Tabs.Panel>
                <Tabs.Panel value="ip">
                    <NodeIpPoolCard nodeUuid={node.uuid} />
                </Tabs.Panel>
            </Tabs>

            <ModalFooter isMobile={isMobile}>
                {node && (
                    <Menu keepMounted={true} position="top-end" shadow="md">
                        <Menu.Target>
                            <Button
                                color="gray"
                                leftSection={<TbDots size={px('1.2rem')} />}
                                size="md"
                            >
                                {t('base-node-form.more-actions')}
                            </Button>
                        </Menu.Target>

                        <Menu.Dropdown>
                            <DeleteNodeFeature handleClose={handleClose} node={node} />
                            <Menu.Divider />

                            <Menu.Label>{t('base-node-form.management')}</Menu.Label>
                            <CopyButton value={node.uuid}>
                                {({ copy }) => (
                                    <Menu.Item leftSection={<TbCopy size="16px" />} onClick={copy}>
                                        {t('common.copy-uuid')}
                                    </Menu.Item>
                                )}
                            </CopyButton>
                            <ResetNodeTrafficFeature handleClose={handleClose} node={node} />

                            <RestartNodeButtonFeature handleClose={handleClose} node={node} />
                            <ToggleNodeStatusButtonFeature handleClose={handleClose} node={node} />
                        </Menu.Dropdown>
                    </Menu>
                )}
                <Button
                    color="teal"
                    disabled={!form.isDirty() || !form.isTouched()}
                    leftSection={<PiFloppyDiskDuotone size="16px" />}
                    loading={isDataSubmitting}
                    onClick={handleSubmit}
                    size="md"
                    variant="light"
                >
                    {t('common.save')}
                </Button>
            </ModalFooter>
        </>
    )
}
