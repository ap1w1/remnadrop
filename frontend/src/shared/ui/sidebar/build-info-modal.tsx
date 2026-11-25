import { Alert, Badge, Button, Card, Code, CopyButton, Group, Loader, Stack, Text } from '@mantine/core'
import { GetMetadataCommand } from '@remnawave/backend-contract'
import { useCallback, useEffect, useState } from 'react'
import { TbBrandGithub, TbCheck, TbCopy, TbRefresh, TbShieldCheck } from 'react-icons/tb'

import { instance } from '@shared/api/axios'

type Update = { state:'queued'|'running'|'success'|'failed'; message?:string; log?:string; finishedAt?:string }
type Status = { available:boolean; installedSha:string|null; latestSha:string|null; checkError:string|null; updateAvailable:boolean; update:Update|null }
const command='sudo remnadrop update'

interface BuildInfoModalProps {
    remnawaveMetadata:GetMetadataCommand.Response['response']
    isNewVersionAvailable?:boolean
}

export function BuildInfoModal({remnawaveMetadata}:BuildInfoModalProps){
    const [status,setStatus]=useState<Status|null>(null)
    const [loading,setLoading]=useState(true)
    const [submitting,setSubmitting]=useState(false)
    const [error,setError]=useState('')
    const refresh=useCallback(async()=>{
        try {
            const data=await instance.get<{response:Status}>('/api/panel-updates')
            setStatus(data.data.response)
            setError('')
        }catch(e){setError(e instanceof Error?e.message:'Не удалось проверить обновления')}
        finally{setLoading(false)}
    },[])
    useEffect(()=>{
        void refresh()
        const timer=window.setInterval(()=>void refresh(),10000)
        return ()=>window.clearInterval(timer)
    },[refresh])
    const start=async()=>{
        setSubmitting(true)
        try{await instance.post('/api/panel-updates'); await refresh()}
        catch(e){setError(e instanceof Error?e.message:'Не удалось запустить обновление')}
        finally{setSubmitting(false)}
    }
    const active=status?.update?.state==='queued'||status?.update?.state==='running'
    return <Stack gap="md">
        <Group justify="space-between" align="center">
            <div><Text fw={700} size="lg">Обновления RemnaDrop</Text><Text size="xs" c="dimmed">Проверка коммита main на GitHub</Text></div>
            <Button size="xs" variant="light" leftSection={<TbRefresh size={16}/>} loading={loading} onClick={()=>{setLoading(true);void refresh()}}>Проверить</Button>
        </Group>
        <Card withBorder p="sm" radius="md">
            <Text size="xs" c="dimmed">Установленная панель</Text>
            <Text fw={700}>Remnawave {remnawaveMetadata.version} · RemnaDrop {status?.installedSha?.slice(0,12)||'версия неизвестна'}</Text>
            {status?.latestSha&&<Text size="sm" mt="xs">Последний коммит: <Code>{status.latestSha.slice(0,12)}</Code> {status.updateAvailable?<Badge color="cyan">Доступно обновление</Badge>:<Badge color="teal">Актуально</Badge>}</Text>}
        </Card>
        {loading&&<Group gap="xs"><Loader size="xs"/><Text size="sm">Проверяем...</Text></Group>}
        {error&&<Alert color="red" title="Ошибка">{error}</Alert>}
        {status?.checkError&&<Alert color="yellow" title="Не удалось проверить GitHub">{status.checkError}. Обновление можно запустить вручную.</Alert>}
        {status?.update&&<Alert color={status.update.state==='failed'?'red':status.update.state==='success'?'teal':'cyan'} title={status.update.state==='queued'?'Обновление в очереди':status.update.state==='running'?'Обновление выполняется':status.update.state==='success'?'Обновление завершено':'Обновление не удалось'}>
            {status.update.message}{status.update.finishedAt&&` · ${new Date(status.update.finishedAt).toLocaleString('ru-RU')}`}
            {status.update.state==='failed'&&status.update.log&&<Text size="xs" mt="xs" style={{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}}>{status.update.log}</Text>}
        </Alert>}
        <Card withBorder p="md" radius="md"><Stack gap="sm">
            <Group gap="xs"><TbShieldCheck size={18}/><Text fw={700}>Обновление с резервной копией</Text></Group>
            <Text size="sm">Сервер соберёт новый образ, сохранит PostgreSQL и конфигурацию, проверит резервную копию и переключит панель после проверок.</Text>
            <Button onClick={()=>void start()} loading={submitting} disabled={!status?.available||active} fullWidth>Обновить панель</Button>
            {!status?.available&&<Text size="xs" c="dimmed">Агент обновлений на сервере ещё не установлен. Установите свежую версию через CLI.</Text>}
            <Group justify="space-between" gap="xs"><Code>{command}</Code><CopyButton value={command}>{({copied,copy})=><Button size="xs" variant="light" leftSection={copied?<TbCheck size={16}/>:<TbCopy size={16}/>} onClick={copy}>{copied?'Скопировано':'Копировать'}</Button>}</CopyButton></Group>
        </Stack></Card>
        <Button component="a" href="https://github.com/ap1w1/remnadrop" target="_blank" rel="noopener noreferrer" leftSection={<TbBrandGithub size={18}/>} variant="default" fullWidth>Открыть RemnaDrop на GitHub</Button>
    </Stack>
}
