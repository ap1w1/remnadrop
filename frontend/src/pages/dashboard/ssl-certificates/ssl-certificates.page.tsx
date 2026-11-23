import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Modal,
    MultiSelect,
    Paper,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    TagsInput,
    Text,
    TextInput,
    Tooltip
} from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { TbCertificate, TbEdit, TbPlus, TbTrash } from 'react-icons/tb'

import { instance } from '@shared/api/axios'
import { Certificate, errorMessage } from '@shared/api/panel-events'
import { Page, PageHeaderShared } from '@shared/ui'

type Form = Omit<Certificate, 'id' | 'nodeNames'>
const initial: Form = {
    name: '',
    domain: '',
    nodeUuids: [],
    expiresOn: '',
    reminderDays: [3, 2, 1],
    enabled: true
}
const daysRemaining = (date: string) =>
    Math.round(
        (Date.parse(`${date}T00:00:00Z`) -
            Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
            86400000
    )

export function SslCertificatesPage() {
    const client = useQueryClient()
    const certificates = useQuery({
        queryKey: ['ssl-certificates'],
        queryFn: async (): Promise<Certificate[]> =>
            (await instance.get('/api/ssl-certificates')).data.response
    })
    const nodes = useQuery({
        queryKey: ['ssl-node-options'],
        queryFn: async (): Promise<{ uuid: string; name: string }[]> =>
            (await instance.get('/api/nodes')).data.response
    })
    const [opened, setOpened] = useState(false)
    const [editing, setEditing] = useState<string>()
    const [form, setForm] = useState<Form>(initial)
    const [days, setDays] = useState(['3', '2', '1'])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [deleting, setDeleting] = useState<Certificate | null>(null)
    const [filterNode, setFilterNode] = useState<string[]>([])
    const open = (cert?: Certificate) => {
        setEditing(cert?.id)
        setForm(cert ? { ...cert } : { ...initial })
        setDays((cert?.reminderDays || initial.reminderDays).map(String))
        setError('')
        setOpened(true)
    }
    const refresh = () => client.invalidateQueries({ queryKey: ['ssl-certificates'] })
    const all = certificates.data || []
    const filtered = all.filter(
        (cert) => !filterNode.length || cert.nodeUuids.some((node) => filterNode.includes(node))
    )
    const options = (nodes.data || []).map((node) => ({ value: node.uuid, label: node.name }))
    return (
        <Page title="SSL-сертификаты">
            <PageHeaderShared icon={<TbCertificate size={24} />} title="SSL-сертификаты" />
            <Stack gap="lg">
                <Group justify="space-between">
                    <Text c="dimmed" maw={700}>
                        Сертификаты ваших нод, сроки действия и напоминания. Укажите дату окончания
                        — панель отправит события и вебхуки заранее.
                    </Text>
                    <Button leftSection={<TbPlus size={18} />} onClick={() => open()}>
                        Добавить сертификат
                    </Button>
                </Group>
                <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md">
                    {[
                        ['Всего сертификатов', all.length, 'cyan'],
                        [
                            'Скоро истекают',
                            all.filter(
                                (c) =>
                                    c.enabled &&
                                    daysRemaining(c.expiresOn) > 0 &&
                                    daysRemaining(c.expiresOn) <= Math.max(...c.reminderDays)
                            ).length,
                            'orange'
                        ],
                        [
                            'Истекли',
                            all.filter((c) => c.enabled && daysRemaining(c.expiresOn) <= 0).length,
                            'red'
                        ]
                    ].map(([label, count, color]) => (
                        <Paper key={label} withBorder p="lg" radius="md">
                            <Text c="dimmed" size="sm">
                                {label}
                            </Text>
                            <Text size="xl" fw={700} c={String(color)} mt="xs">
                                {count}
                            </Text>
                        </Paper>
                    ))}
                </SimpleGrid>
                <MultiSelect
                    label="Ноды"
                    placeholder="Все ноды"
                    data={options}
                    searchable
                    clearable
                    value={filterNode}
                    onChange={setFilterNode}
                    maw={480}
                />
                {(certificates.isError || nodes.isError) && (
                    <Alert color="red">{errorMessage(certificates.error || nodes.error)}</Alert>
                )}
                {certificates.isLoading ? (
                    <Center p="xl">
                        <Loader />
                    </Center>
                ) : filtered.length === 0 ? (
                    <Paper withBorder p="xl" ta="center">
                        <TbCertificate size={40} />
                        <Text fw={600} mt="md">
                            {filterNode.length
                                ? 'Для выбранных нод нет сертификатов'
                                : 'Добавьте первый сертификат'}
                        </Text>
                        <Text c="dimmed" size="sm" mt="xs">
                            Выберите ноды, укажите сертификат и срок действия. По умолчанию напомним
                            за 3, 2 и 1 день.
                        </Text>
                    </Paper>
                ) : (
                    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
                        <Table.ScrollContainer minWidth={780}>
                            <Table verticalSpacing="md" horizontalSpacing="md" highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        {[
                                            'Сертификат',
                                            'Ноды',
                                            'Истекает',
                                            'Напомнить за',
                                            'Статус',
                                            'Действия'
                                        ].map((title) => (
                                            <Table.Th key={title}>{title}</Table.Th>
                                        ))}
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {filtered.map((cert) => {
                                        const remaining = daysRemaining(cert.expiresOn)
                                        const status = !cert.enabled
                                            ? 'Приостановлен'
                                            : remaining <= 0
                                              ? 'Истёк'
                                              : remaining <= Math.max(...cert.reminderDays)
                                                ? `Осталось ${remaining} дн.`
                                                : 'Действует'
                                        return (
                                            <Table.Tr key={cert.id}>
                                                <Table.Td>
                                                    <Text fw={600} size="sm">
                                                        {cert.name}
                                                    </Text>
                                                    <Text size="xs" c="dimmed">
                                                        {cert.domain}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="sm" maw={260}>
                                                        {cert.nodeNames.join(', ') ||
                                                            'Ноды удалены'}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="sm">
                                                        {new Date(
                                                            `${cert.expiresOn}T00:00:00Z`
                                                        ).toLocaleDateString(undefined, {
                                                            timeZone: 'UTC'
                                                        })}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="sm">
                                                        {cert.reminderDays.join(', ')} дн.
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        variant="light"
                                                        color={
                                                            !cert.enabled
                                                                ? 'gray'
                                                                : remaining <= 0
                                                                  ? 'red'
                                                                  : remaining <=
                                                                      Math.max(...cert.reminderDays)
                                                                    ? 'orange'
                                                                    : 'teal'
                                                        }
                                                    >
                                                        {status}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap="xs" wrap="nowrap">
                                                        <Tooltip label="Редактировать">
                                                            <ActionIcon
                                                                size={40}
                                                                variant="subtle"
                                                                aria-label={`Редактировать ${cert.name}`}
                                                                onClick={() => open(cert)}
                                                            >
                                                                <TbEdit size={19} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                        <Tooltip label="Удалить">
                                                            <ActionIcon
                                                                size={40}
                                                                variant="subtle"
                                                                color="red"
                                                                aria-label={`Удалить ${cert.name}`}
                                                                onClick={() => {
                                                                    setError('')
                                                                    setDeleting(cert)
                                                                }}
                                                            >
                                                                <TbTrash size={19} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        )
                                    })}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    </Paper>
                )}
            </Stack>
            <Modal
                opened={opened}
                onClose={() => !busy && setOpened(false)}
                title={editing ? 'Редактировать сертификат' : 'Добавить SSL-сертификат'}
                size="lg"
                centered
            >
                <form
                    onSubmit={(event) => {
                        event.preventDefault()
                        void (async () => {
                            setError('')
                            if (
                                !days.length ||
                                days.some(
                                    (day) =>
                                        !/^\d+$/.test(day) || Number(day) < 1 || Number(day) > 365
                                ) ||
                                days.length > 30
                            ) {
                                setError('Укажите до 30 сроков: целые числа от 1 до 365')
                                return
                            }
                            if (!form.nodeUuids.length) {
                                setError('Выберите хотя бы одну ноду')
                                return
                            }
                            setBusy(true)
                            try {
                                const payload = {
                                    ...form,
                                    reminderDays: [...new Set(days.map(Number))]
                                }
                                if (editing)
                                    await instance.put(`/api/ssl-certificates/${editing}`, payload)
                                else await instance.post('/api/ssl-certificates', payload)
                                await refresh()
                                setOpened(false)
                            } catch (e) {
                                setError(errorMessage(e))
                            } finally {
                                setBusy(false)
                            }
                        })()
                    }}
                >
                    <Stack>
                        <TextInput
                            required
                            label="Название сертификата"
                            placeholder="Основной сертификат"
                            maxLength={120}
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                        />
                        <TextInput
                            required
                            label="Домен"
                            placeholder="vpn.example.com или *.example.com"
                            value={form.domain}
                            onChange={(e) => setForm({ ...form, domain: e.currentTarget.value })}
                        />
                        <MultiSelect
                            required
                            label="Ноды с этим сертификатом"
                            searchable
                            data={options}
                            value={form.nodeUuids}
                            onChange={(nodeUuids) => setForm({ ...form, nodeUuids })}
                            error={nodes.isError ? 'Не удалось загрузить ноды' : undefined}
                        />
                        <TextInput
                            type="date"
                            required
                            label="Дата окончания действия"
                            description="Напоминания рассчитываются по календарным дням UTC"
                            min="2000-01-01"
                            max="2200-12-31"
                            value={form.expiresOn}
                            onChange={(e) => setForm({ ...form, expiresOn: e.currentTarget.value })}
                        />
                        <TagsInput
                            label="За сколько дней напомнить"
                            description="Введите число и нажмите Enter. Например: 3, 2, 1. В день истечения придёт отдельное событие."
                            value={days}
                            onChange={setDays}
                            splitChars={[',', ' ']}
                        />
                        <Switch
                            label="Напоминания включены"
                            checked={form.enabled}
                            onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })}
                        />
                        <Text size="xs" c="dimmed">
                            После продления обновите дату — напоминания начнутся заново. Сертификаты
                            учитываются вручную; файлы и закрытые ключи загружать не нужно.
                        </Text>
                        {error && <Alert color="red">{error}</Alert>}
                        <Group justify="end">
                            <Button
                                variant="default"
                                disabled={busy}
                                onClick={() => setOpened(false)}
                            >
                                Отмена
                            </Button>
                            <Button
                                type="submit"
                                loading={busy}
                                disabled={nodes.isError || nodes.isLoading}
                            >
                                Сохранить
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>
            <Modal
                opened={!!deleting}
                onClose={() => !busy && setDeleting(null)}
                title="Удалить сертификат?"
                centered
            >
                <Stack>
                    <Text>
                        «{deleting?.name}» будет удалён из учёта. Файлы на нодах сохранятся.
                    </Text>
                    {error && <Alert color="red">{error}</Alert>}
                    <Group justify="end">
                        <Button variant="default" disabled={busy} onClick={() => setDeleting(null)}>
                            Отмена
                        </Button>
                        <Button
                            color="red"
                            loading={busy}
                            onClick={() =>
                                void (async () => {
                                    setBusy(true)
                                    setError('')
                                    try {
                                        await instance.delete(
                                            `/api/ssl-certificates/${deleting!.id}`
                                        )
                                        await refresh()
                                        setDeleting(null)
                                    } catch (e) {
                                        setError(errorMessage(e))
                                    } finally {
                                        setBusy(false)
                                    }
                                })()
                            }
                        >
                            Удалить
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Page>
    )
}
