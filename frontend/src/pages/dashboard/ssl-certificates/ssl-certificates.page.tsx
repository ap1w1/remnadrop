import {
    Alert, Badge, Button, Card, Divider, Group, Modal, MultiSelect, Select, SimpleGrid,
    Skeleton, Stack, Switch, Text, Textarea, TextInput, ThemeIcon, Title
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { TbBell, TbCertificate, TbEdit, TbPlus, TbSearch, TbTrash } from 'react-icons/tb'
import { Link } from 'react-router'

import { instance } from '@shared/api/axios'
import { apiError, type Certificate, type CertificateInput, eventDate, EVENTS_PATH, SSL_API } from '@shared/api/panel-events'
import { Page } from '@shared/ui'

type Node = { uuid: string; name: string }
const statuses = {
    valid: { label: 'Действует', color: 'teal' },
    expiring: { label: 'Скоро истечёт', color: 'yellow' },
    expired: { label: 'Истёк', color: 'red' },
    disabled: { label: 'Напоминания выключены', color: 'gray' }
}
const fresh = (): CertificateInput => ({ name: '', domains: [], nodeUuids: [], expiresAt: '', reminderDays: [3, 2, 1], enabled: true })
function localDate(value: string) {
    if (!value) return ''
    const date = new Date(value)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function SslCertificatesPage() {
    const client = useQueryClient()
    const mobile = useMediaQuery('(max-width: 48em)')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<string | null>(null)
    const [editing, setEditing] = useState<Certificate | 'new' | null>(null)
    const [draft, setDraft] = useState<CertificateInput>(fresh)
    const [domains, setDomains] = useState('')
    const [expiry, setExpiry] = useState('')
    const [days, setDays] = useState('3, 2, 1')
    const [formError, setFormError] = useState('')
    const [deleting, setDeleting] = useState<Certificate | null>(null)

    const certificates = useQuery({ queryKey: ['ssl-certificates'], queryFn: async () => (await instance.get<{ response: { items: Certificate[] } }>(SSL_API)).data.response.items })
    const nodes = useQuery({ queryKey: ['ssl-certificate-nodes'], queryFn: async () => (await instance.get<{ response: Node[] }>('/api/nodes')).data.response })
    const save = useMutation({
        mutationFn: async (input: CertificateInput) => editing && editing !== 'new'
            ? instance.put(`${SSL_API}/${editing.id}`, input) : instance.post(SSL_API, input),
        onSuccess: async () => { await client.invalidateQueries({ queryKey: ['ssl-certificates'] }); setEditing(null) }
    })
    const remove = useMutation({
        mutationFn: async (id: string) => instance.delete(`${SSL_API}/${id}`),
        onSuccess: async () => { await client.invalidateQueries({ queryKey: ['ssl-certificates'] }); setDeleting(null) }
    })

    const rows = useMemo(() => (certificates.data || []).filter(item =>
        (!status || item.status === status) &&
        [item.name, ...item.domains, ...item.nodes.map(node => node.name)].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())
    ), [certificates.data, status, search])
    const expiredCount = (certificates.data || []).filter(item => item.status === 'expired').length
    const expiringCount = (certificates.data || []).filter(item => item.status === 'expiring').length
    const startEdit = (item?: Certificate) => {
        save.reset(); setFormError('')
        setEditing(item || 'new')
        setDraft(item ? { name: item.name, domains: item.domains, nodeUuids: item.nodeUuids, expiresAt: item.expiresAt, reminderDays: item.reminderDays, enabled: item.enabled } : fresh())
        setDomains(item?.domains.join('\n') || '')
        setExpiry(localDate(item?.expiresAt || ''))
        setDays((item?.reminderDays || [3, 2, 1]).join(', '))
    }
    const submit = (event: React.FormEvent) => {
        event.preventDefault(); setFormError('')
        const date = new Date(expiry)
        const reminders = days.split(/[,;\s]+/).filter(Boolean).map(Number)
        const domainNames = domains.split(/[,;\s]+/).map(value => value.trim().toLowerCase()).filter(Boolean)
        if (!draft.name.trim() || !draft.nodeUuids.length || !expiry || !Number.isFinite(date.getTime())) { setFormError('Укажите название, хотя бы одну ноду и дату истечения.'); return }
        if (reminders.length > 20 || reminders.some(value => !Number.isInteger(value) || value < 1 || value > 365)) { setFormError('Укажите не более 20 сроков: целые числа от 1 до 365 дней через запятую.'); return }
        if (!domainNames.length) { setFormError('Укажите хотя бы один домен сертификата.'); return }
        save.mutate({ ...draft, name: draft.name.trim(), domains: [...new Set(domainNames)], expiresAt: date.toISOString(), reminderDays: [...new Set(reminders)].sort((a, b) => b - a) })
    }

    return <Page title="SSL-сертификаты"><Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap"><Group gap="sm"><ThemeIcon size={48} radius="md" variant="light" color="teal"><TbCertificate size={27} /></ThemeIcon><div><Title order={2}>SSL-сертификаты</Title><Text size="sm" c="dimmed">Сроки действия сертификатов и напоминания по нодам</Text></div></Group><Button h={44} leftSection={<TbPlus size={18} />} onClick={() => startEdit()}>Добавить сертификат</Button></Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
            {[{ title: 'Всего сертификатов', count: certificates.data?.length || 0, color: 'cyan' }, { title: 'Скоро истекут', count: expiringCount, color: 'yellow' }, { title: 'Истекли', count: expiredCount, color: 'red' }].map(item => <Card key={item.title} withBorder radius="md" p="lg"><Text size="sm" c="dimmed">{item.title}</Text><Text fw={700} size="xl" c={item.color}>{certificates.isPending ? '—' : item.count}</Text></Card>)}
        </SimpleGrid>
        <Card withBorder radius="md" p="lg"><Stack gap="md"><SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput label="Поиск" placeholder="Название, домен или нода" leftSection={<TbSearch size={18} />} value={search} onChange={event => setSearch(event.currentTarget.value)} /><Select label="Состояние" placeholder="Все сертификаты" clearable value={status} onChange={setStatus} data={Object.entries(statuses).map(([value, item]) => ({ value, label: item.label }))} /></SimpleGrid><Group justify="space-between" gap="sm"><Text size="sm" c="dimmed" maw={780}>Укажите дату из сертификата. Напоминания появятся в «Событиях» и будут отправлены в настроенные вебхуки панели.</Text><Button h={44} component={Link} to={EVENTS_PATH} variant="subtle" leftSection={<TbBell size={18} />}>К событиям</Button></Group></Stack></Card>
        {certificates.isError && <Alert color="red" title="Не удалось загрузить сертификаты"><Stack><Text size="sm">{apiError(certificates.error, 'Проверьте соединение и повторите попытку.')}</Text><Button variant="light" color="red" onClick={() => void certificates.refetch()}>Повторить</Button></Stack></Alert>}
        {certificates.isPending ? <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>{[1, 2, 3].map(id => <Skeleton key={id} h={260} radius="md" />)}</SimpleGrid> : rows.length ? <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
            {rows.map(item => <Card key={item.id} withBorder radius="md" p="lg" data-certificate-id={item.id}><Stack gap="md" h="100%">
                <Group justify="space-between" align="flex-start" wrap="wrap"><ThemeIcon size={40} radius="md" variant="light" color={statuses[item.status].color}><TbCertificate size={23} /></ThemeIcon><Badge variant="light" color={statuses[item.status].color}>{statuses[item.status].label}</Badge></Group>
                <div><Title order={3} style={{ overflowWrap: 'anywhere' }}>{item.name}</Title><Text size="sm" c="dimmed" mt={4} style={{ overflowWrap: 'anywhere' }}>{item.domains.join(', ')}</Text></div>
                <div><Text size="xs" c="dimmed">Действует до</Text><Text fw={600} c={item.status === 'expired' ? 'red' : undefined}>{eventDate(item.expiresAt)}</Text><Text size="xs" c="dimmed">{new Date(item.expiresAt).getTime() <= Date.now() ? item.daysRemaining < 0 ? `Истёк ${Math.abs(item.daysRemaining)} дн. назад` : 'Истёк сегодня' : item.daysRemaining === 1 ? 'Осталось менее суток' : `Осталось ${item.daysRemaining} дн.`}</Text></div>
                <Group gap={6}>{item.nodes.map(node => <Badge key={node.uuid} variant="outline" color="gray" maw="100%" style={{ textTransform: 'none' }}>{node.name}</Badge>)}</Group>
                <Text size="xs" c="dimmed">{item.enabled ? item.reminderDays.length ? `Напомнить за ${item.reminderDays.join(', ')} дн. и при истечении` : 'Напомнить при истечении' : 'Напоминания выключены'}</Text>
                <Divider mt="auto" /><Group justify="space-between" gap="xs"><Button h={44} variant="light" leftSection={<TbEdit size={17} />} onClick={() => startEdit(item)}>Изменить</Button><Button h={44} variant="subtle" color="red" leftSection={<TbTrash size={17} />} onClick={() => { remove.reset(); setDeleting(item) }}>Удалить</Button></Group>
            </Stack></Card>)}
        </SimpleGrid> : !certificates.isError && <Card withBorder radius="md" p="xl"><Stack align="center" gap="sm" py="xl"><ThemeIcon size={64} radius="xl" variant="light" color="teal"><TbCertificate size={32} /></ThemeIcon><Title order={3}>{search || status ? 'Ничего не найдено' : 'Добавьте первый сертификат'}</Title><Text c="dimmed" ta="center" maw={500}>{search || status ? 'Измените запрос или состояние.' : 'Свяжите сертификат с нодами и задайте дату истечения. Панель напомнит о продлении заранее.'}</Text>{!search && !status && <Button h={44} mt="sm" leftSection={<TbPlus size={18} />} onClick={() => startEdit()}>Добавить сертификат</Button>}</Stack></Card>}

        <Modal opened={editing !== null} onClose={() => !save.isPending && setEditing(null)} title={editing === 'new' ? 'Новый SSL-сертификат' : 'Редактирование сертификата'} size="lg" fullScreen={mobile} centered closeOnClickOutside={!save.isPending}>
            <form onSubmit={submit}><Stack gap="md">
                {(formError || save.isError) && <Alert color="red" title="Не удалось сохранить">{formError || apiError(save.error, 'Проверьте данные и повторите попытку.')}</Alert>}
                <TextInput required label="Название" placeholder="Например, Подписки · wildcard" maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} />
                <MultiSelect required label="Ноды" description="Выберите ноды, на которых установлен этот сертификат." searchable data={(nodes.data || []).map(node => ({ value: node.uuid, label: node.name }))} value={draft.nodeUuids} onChange={value => setDraft({ ...draft, nodeUuids: value })} disabled={nodes.isPending} error={nodes.isError ? 'Не удалось загрузить ноды' : undefined} nothingFoundMessage="Ноды не найдены" />
                {nodes.isError && <Button variant="light" onClick={() => void nodes.refetch()}>Загрузить ноды повторно</Button>}
                <Textarea required label="Домены сертификата" description="Каждый домен с новой строки или через запятую. Допускается *.example.com." placeholder={'example.com\n*.example.com'} autosize minRows={2} maxRows={6} value={domains} onChange={event => setDomains(event.currentTarget.value)} />
                <TextInput required type="datetime-local" label="Дата и время истечения" description={`Часовой пояс браузера: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} value={expiry} onChange={event => setExpiry(event.currentTarget.value)} />
                {expiry && Number.isFinite(new Date(expiry).getTime()) && new Date(expiry).getTime() < Date.now() && <Alert color="yellow">Указанная дата уже прошла. При включённых напоминаниях появится событие об истечении.</Alert>}
                <TextInput label="Напомнить за сколько дней" description="До 20 целых чисел через запятую, от 1 до 365. Пусто — только при истечении." placeholder="3, 2, 1" value={days} onChange={event => setDays(event.currentTarget.value)} />
                <Switch label="Напоминания включены" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.currentTarget.checked })} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
                <Divider /><Group justify="flex-end"><Button h={44} variant="default" disabled={save.isPending} onClick={() => setEditing(null)}>Отмена</Button><Button h={44} type="submit" loading={save.isPending} disabled={nodes.isPending || nodes.isError}>Сохранить</Button></Group>
            </Stack></form>
        </Modal>
        <Modal opened={deleting !== null} onClose={() => !remove.isPending && setDeleting(null)} title="Удалить сертификат?" centered>
            <Stack gap="md"><Text size="sm">Запись «{deleting?.name}» и её будущие напоминания будут удалены. Сам сертификат на нодах и события в журнале сохранятся.</Text>{remove.isError && <Alert color="red">{apiError(remove.error, 'Не удалось удалить запись. Повторите попытку.')}</Alert>}<Group justify="flex-end"><Button h={44} variant="default" disabled={remove.isPending} onClick={() => setDeleting(null)}>Отмена</Button><Button h={44} color="red" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Удалить запись</Button></Group></Stack>
        </Modal>
    </Stack></Page>
}
