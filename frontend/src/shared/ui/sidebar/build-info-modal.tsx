import { Alert, Badge, Button, Card, Code, CopyButton, Divider, Group, Loader, Stack, Text, Tooltip } from '@mantine/core'
import { GetMetadataCommand } from '@remnawave/backend-contract'
import { useCallback, useEffect, useState } from 'react'
import { TbBrandGithub, TbCheck, TbCopy, TbExternalLink, TbRefresh, TbShieldCheck, TbTerminal2 } from 'react-icons/tb'

type Release={
    tag_name:string
    name:string
    body:string|null
    published_at:string|null
    html_url:string
}
const repo='https://github.com/ap1w1/remnadrop'
const endpoint='https://api.github.com/repos/ap1w1/remnadrop/releases/latest'
const command='sudo remnadrop update'

interface BuildInfoModalProps {
    remnawaveMetadata:GetMetadataCommand.Response['response']
    isNewVersionAvailable?:boolean
}

/** Public GitHub Releases feed. Private repos intentionally do not expose credentials in browser. */
export function BuildInfoModal({remnawaveMetadata}:BuildInfoModalProps){
    const [release,setRelease]=useState<Release|null>(null)
    const [loading,setLoading]=useState(true)
    const [error,setError]=useState('')
    const refresh=useCallback(async(signal?:AbortSignal)=>{
        setLoading(true);setError('')
        try{
            const response=await fetch(endpoint,{
                headers:{Accept:'application/vnd.github+json'},signal
            })
            if(!response.ok){
                if(response.status===404){
                    throw new Error('Публичных релизов пока нет. Пока репозиторий закрыт, GitHub не показывает его обновления без авторизации.')
                }
                throw new Error('GitHub вернул HTTP '+response.status+'. Проверьте подключение и попробуйте снова.')
            }
            const data=await response.json() as Release
            if(!data.tag_name||!data.html_url)throw new Error('Некорректный ответ GitHub Releases')
            setRelease(data)
        }catch(e){
            if(signal?.aborted)return
            setRelease(null)
            setError(e instanceof Error?e.message:'Не удалось проверить обновления')
        }finally{if(!signal?.aborted)setLoading(false)}
    },[])
    useEffect(()=>{
        const controller=new AbortController()
        void refresh(controller.signal)
        return ()=>controller.abort()
    },[refresh])
    return <Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap">
            <div><Text fw={700} size="lg">Обновления RemnaDrop</Text><Text size="xs" c="dimmed">Информация из GitHub Releases</Text></div>
            <Button size="xs" variant="light" leftSection={<TbRefresh size={16}/>} loading={loading} onClick={()=>void refresh()}>Проверить</Button>
        </Group>
        <Card withBorder p="sm" radius="md">
            <Group justify="space-between" align="center"><div><Text size="xs" c="dimmed">Установленная база</Text><Text fw={700}>Remnawave {remnawaveMetadata.version} · Fork RemnaDrop</Text></div><Badge variant="light" color="teal">Локальная панель</Badge></Group>
            <Text c="dimmed" size="xs" mt="xs">Это версия базовой Remnawave, а не номер коммита форка. Пока сборка не передаёт Git SHA в метаданные, автоматическое сравнение установленных и доступных версий недостоверно.</Text>
        </Card>
        {loading&&<Group gap="xs"><Loader size="xs"/><Text size="sm">Проверяем релизы...</Text></Group>}
        {!loading&&error&&<Alert color="yellow" title="Проверка обновлений недоступна">{error}</Alert>}
        {!loading&&release&&<Card withBorder p="md" radius="md"><Stack gap="xs">
            <Group justify="space-between"><Text fw={700}>Последний релиз</Text><Badge color="cyan">{release.tag_name}</Badge></Group>
            <Text fw={600}>{release.name||release.tag_name}</Text>
            {release.published_at&&<Text size="xs" c="dimmed">Опубликовано: {new Date(release.published_at).toLocaleString('ru-RU')}</Text>}
            <Divider/>
            <Text size="sm" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{(release.body||'Описание обновления пока не опубликовано').slice(0,2000)}</Text>
            <Button component="a" href={release.html_url} target="_blank" rel="noopener noreferrer" size="sm" variant="light" leftSection={<TbExternalLink size={16}/>}>Посмотреть релиз</Button>
        </Stack></Card>}
        <Card withBorder p="md" radius="md"><Stack gap="sm">
            <Group gap="xs"><TbShieldCheck size={18} color="var(--mantine-color-teal-5)"/><Text fw={700}>Обновление с резервной копией</Text></Group>
            <Text size="sm">Для безопасного обновления запустите команду на VPS. Установщик собирает образ, делает резервную копию PostgreSQL и конфигурации, проверяет восстановление БД и только затем применяет миграции.</Text>
            <Group justify="space-between" gap="xs" align="center" wrap="wrap">
                <Code fz="sm">{command}</Code>
                <CopyButton value={command}>
                    {({copied,copy})=><Tooltip label={copied?'Скопировано':'Скопировать команду'}>
                        <Button size="sm" variant="light" leftSection={copied?<TbCheck size={16}/>:<TbCopy size={16}/>} onClick={copy}>{copied?'Скопировано':'Скопировать'}</Button>
                    </Tooltip>}
                </CopyButton>
            </Group>
            <Alert color="orange" icon={<TbTerminal2 size={18}/>}>Автоматический запуск обновления из браузера пока не включён: для него нужен отдельный защищённый агент на VPS. Кнопка копирует команду, но не изменяет работающую панель.</Alert>
        </Stack></Card>
        <Button component="a" href={repo} target="_blank" rel="noopener noreferrer" leftSection={<TbBrandGithub size={18}/>} variant="default" fullWidth>Открыть RemnaDrop на GitHub</Button>
    </Stack>
}
