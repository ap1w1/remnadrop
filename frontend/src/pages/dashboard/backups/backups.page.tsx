import { Alert, Badge, Button, Card, Divider, Group, Modal, NumberInput, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { TbTrash, TbArchive, TbCloud, TbDatabase, TbDeviceFloppy, TbPlayerPlay, TbPlus, TbRefresh, TbSettings } from 'react-icons/tb'
import { instance } from '@shared/api/axios'
import { Page } from '@shared/ui'
import { HelpActionIconShared } from '@shared/ui/help-drawer'

type Provider = 'local' | 's3' | 'ftp' | 'gdrive'
type Target = { id:string;name:string;provider:Provider;remoteName:string;remotePath:string;intervalMinutes:number;retentionDays:number;maxBytes:string;autoDelete:boolean;webhookEnabled:boolean;enabled:boolean;nextRunAt:string|null;lastRunAt:string|null;lastStatus:string|null;lastUsageBytes:string|null;lastUsageAt:string|null }
type BackupRun = { id:string;targetId:string;status:string;fileName:string|null;sizeBytes:string|null;sha256:string|null;startedAt:string;finishedAt:string|null;error:string|null;deletedAt:string|null;deleteRequestedAt?:string|null;deleteError?:string|null }
type Payload = {name:string;provider:Provider;remoteName:string;remotePath:string;intervalMinutes:number;retentionDays:number;maxBytes:number;autoDelete:boolean;webhookEnabled:boolean;enabled:boolean}
const blank:Payload={name:'',provider:'local',remoteName:'',remotePath:'remnadrop',intervalMinutes:1440,retentionDays:30,maxBytes:10737418240,autoDelete:true,webhookEnabled:false,enabled:true}
const providerLabel:Record<Provider,string>={local:'Локально',s3:'S3',ftp:'FTP / SFTP',gdrive:'Google Drive'}
const intervalLabels=[{value:'60',label:'Каждый час'},{value:'360',label:'Каждые 6 часов'},{value:'720',label:'Каждые 12 часов'},{value:'1440',label:'Каждые сутки'},{value:'10080',label:'Каждую неделю'}]
const statusColor=(s:string|null)=>s==='completed'?'teal':s==='failed'?'red':s==='running'?'yellow':'gray'
const statusName=(s:string|null)=>({completed:'Успешно',failed:'Ошибка',running:'Выполняется'} as Record<string,string>)[s??'']??'Нет запусков'
const size=(bytes:string|null)=>{if(bytes===null || bytes==='')return '—';const n=Number(bytes);if(!Number.isFinite(n))return '—';return n>=1073741824?`${(n/1073741824).toFixed(2)} ГиБ`:`${(n/1048576).toFixed(1)} МиБ`}
const percent=(used:string|null,max:string)=>Math.min(100,Math.max(0,100*Number(used??0)/Number(max)))
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('ru-RU'):'—'
function errorMessage(e:unknown){const r=e as {response?:{data?:{message?:string|string[]}}};return String(r.response?.data?.message??'Не удалось выполнить операцию')}

export function BackupsPage(){
  const [targets,setTargets]=useState<Target[]>([]),[runs,setRuns]=useState<BackupRun[]>([])
  const [agent,setAgent]=useState<{lastSeen:string|null;lastError:string|null;online:boolean}>({lastSeen:null,lastError:null,online:false})
  const [opened,setOpened]=useState(false),[editing,setEditing]=useState<string|null>(null)
  const [form,setForm]=useState<Payload>(blank),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState('')
  const [pendingTargets,setPendingTargets]=useState<Record<string,string>>({}),[starting,setStarting]=useState<string|null>(null)
  const refresh=useCallback(async()=>{const response=await instance.get('/api/backups');const data=response.data.response as {targets:Target[];runs:BackupRun[];agent:{lastSeen:string|null;lastError:string|null;online:boolean}};setTargets(data.targets);setRuns(data.runs);setAgent(data.agent);setPendingTargets(previous=>Object.fromEntries(Object.entries(previous).filter(([id,queuedAt])=>!data.runs.some(run=>run.targetId===id&&new Date(run.startedAt).getTime()>=new Date(queuedAt).getTime()-2000)))},[])
  useEffect(()=>{void refresh().catch(e=>setError(errorMessage(e)));const timer=setInterval(()=>void refresh().catch(()=>{}),20000);return()=>clearInterval(timer)},[refresh])
  const begin=(target?:Target)=>{setEditing(target?.id??null);setForm(target?{name:target.name,provider:target.provider,remoteName:target.remoteName,remotePath:target.remotePath,intervalMinutes:target.intervalMinutes,retentionDays:target.retentionDays,maxBytes:Number(target.maxBytes),autoDelete:target.autoDelete,webhookEnabled:target.webhookEnabled,enabled:target.enabled}:{...blank});setError('');setOpened(true)}
  const save=async()=>{setError('');setBusy(true);try{if(editing)await instance.patch(`/api/backups/targets/${editing}`,form);else await instance.post('/api/backups/targets',form);setOpened(false);setNotice('Настройки хранилища сохранены. У каждого назначения собственное расписание.');await refresh()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  const run=async(t:Target)=>{setError('');setStarting(t.id);try{const r=await instance.post(`/api/backups/targets/${t.id}/run`);setPendingTargets(previous=>({...previous,[t.id]:new Date().toISOString()}));setNotice(`Копирование «${t.name}» поставлено в очередь. ${r.data.response.note}`);await refresh()}catch(e){setError(errorMessage(e))}finally{setStarting(null)}}
  const remove=async(t:Target)=>{
    if(!window.confirm('Удалить хранилище «'+t.name+'» из списка и остановить его расписание? Существующие файлы бэкапов останутся на диске или в облаке.'))return
    setError('')
    try{const res=await instance.delete('/api/backups/targets/'+t.id);setNotice(res.data.response.note);await refresh()}catch(e){setError(errorMessage(e))}
  }
  const removeRun=async(run:BackupRun)=>{
    if(!window.confirm('Удалить этот архив из хранилища? Операция необратима и будет выполнена агентом на VPS.'))return
    setError('')
    try{const result=await instance.delete('/api/backups/runs/'+run.id);setNotice(result.data.response.note);await refresh()}catch(e){setError(errorMessage(e))}
  }
  const toggle=async(t:Target)=>{setError('');try{await instance.patch(`/api/backups/targets/${t.id}`,{enabled:!t.enabled});await refresh()}catch(e){setError(errorMessage(e))}}
  const latest=(id:string)=>runs.find(r=>r.targetId===id)
  const healthy=targets.filter(t=>t.lastStatus==='completed').length
  return <Page title="Бэкапы"><Stack gap="lg">
    <Group justify="space-between" align="center" wrap="wrap"><Group gap="sm"><TbArchive size={31} color="var(--mantine-primary-color-filled)"/><div><Title order={2}>Бэкапы</Title><Text size="sm" c="dimmed">Резервные копии PostgreSQL: разные расписания, лимиты, срок хранения и вебхуки для каждого хранилища</Text></div></Group><Group><HelpActionIconShared screen="PAGE_BACKUPS"/><Button variant="light" leftSection={<TbRefresh size={17}/>} onClick={()=>void refresh().catch(e=>setError(errorMessage(e)))}>Обновить</Button><Button leftSection={<TbPlus size={17}/>} onClick={()=>begin()}>Добавить хранилище</Button></Group></Group>
    {error&&<Alert color="red" title="Ошибка" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
    {notice&&<Alert color="teal" title="Результат" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
    <SimpleGrid cols={{base:1,sm:3}}><Card withBorder radius="md"><Group gap="xs"><TbDatabase/><Text size="sm" c="dimmed">Хранилищ</Text></Group><Title order={2}>{targets.length}</Title></Card><Card withBorder radius="md"><Group gap="xs"><TbDeviceFloppy/><Text size="sm" c="dimmed">Хранилища с успешным запуском</Text></Group><Title order={2}>{healthy}</Title></Card><Card withBorder radius="md"><Group gap="xs"><TbCloud/><Text size="sm" c="dimmed">Создано копий</Text></Group><Title order={2}>{runs.filter(r=>r.status==='completed'&&!r.deletedAt).length}</Title></Card></SimpleGrid>
    <Alert color={agent.online?"teal":"yellow"} title={agent.online?"Агент резервного копирования работает":"Агент не подключён"}>{agent.online?`Последняя связь: ${when(agent.lastSeen)}`:`Чтобы включить расписание, установите агент один раз на VPS. Инструкция — в «Справочной статье». ${agent.lastError??""}`}</Alert>
    {!targets.length?<Card withBorder padding="xl" radius="md"><Stack align="center" gap="xs"><TbArchive size={44}/><Title order={4}>Хранилища пока не добавлены</Title><Text c="dimmed">Добавьте локальный диск или удалённый rclone-провайдер, затем задайте расписание.</Text><Button onClick={()=>begin()}>Создать хранилище</Button></Stack></Card>:<SimpleGrid cols={{base:1,sm:2,lg:3}} spacing="sm">{targets.map(t=>{
        const last=latest(t.id)
         const pending=!!pendingTargets[t.id]
         const running=last?.status==='running'
        const filled=percent(t.lastUsageBytes,t.maxBytes)
        return <Card key={t.id} withBorder padding="sm" radius="md">
          <Stack gap={8}>
            <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
              <Stack gap={1} style={{minWidth:0}}>
                <Text fw={700} size="sm" truncate>{t.name}</Text>
                <Text size="xs" c="dimmed" truncate>{providerLabel[t.provider]} · {t.provider==='local'?'Диск VPS':t.remoteName+':'+t.remotePath}</Text>
              </Stack>
              <Badge size="xs" color={running||pending?'blue':!t.enabled?'gray':statusColor(t.lastStatus)} variant="light">{running?'Выполняется':pending?'В очереди':!t.enabled?'Пауза':statusName(t.lastStatus)}</Badge>
            </Group>
            <Text c="dimmed" size="xs">{intervalLabels.find(i=>i.value===String(t.intervalMinutes))?.label??'Каждые '+t.intervalMinutes+' мин'} · Хранить {t.retentionDays} дн</Text>
            <Group justify="space-between" gap="xs">
              <Text size="xs">Объём {size(t.lastUsageBytes)} / {size(t.maxBytes)}</Text>
              <Text size="xs" c="dimmed">{t.autoDelete?'Автоочистка':'Без автоочистки'}{t.webhookEnabled?' · Вебхук':''}</Text>
            </Group>
            <Progress value={filled} size="xs" color={filled>=90?'red':filled>=75?'yellow':'teal'} />
             {(pending||running)&&<Alert color="blue" p="xs" title={running?'Создаётся резервная копия':'Ожидание запуска'}><Text size="xs">{running?'Агент выполняет копирование. Статус обновляется автоматически каждые 20 секунд.':'Задание принято. Агент проверяет очередь, обычно в течение минуты.'}</Text></Alert>}
            <Tooltip multiline label={last?.status==='failed'?last.error??'Ошибка': 'Следующий запуск: '+when(t.nextRunAt)}>
              <Text c="dimmed" size="xs" truncate>{last?'Последний: '+when(last.startedAt):'Резервные копии ещё не создавались'}</Text>
            </Tooltip>
            <Group justify="space-between" gap="xs" wrap="wrap">
              <Button size="compact-xs" variant="light" loading={starting===t.id} disabled={pending||running||starting!==null} leftSection={<TbPlayerPlay size={13}/>} onClick={()=>void run(t)}>Создать</Button>
              <Group gap={4}>
                <Tooltip label="Настроить"><Button size="compact-xs" variant="subtle" aria-label={'Настроить '+t.name} onClick={()=>begin(t)}><TbSettings size={16}/></Button></Tooltip>
                <Button size="compact-xs" variant="subtle" onClick={()=>void toggle(t)}>{t.enabled?'Пауза':'Включить'}</Button>
                <Tooltip label="Удалить назначение, сохранив архивы"><Button size="compact-xs" variant="subtle" color="red" aria-label={'Удалить '+t.name} onClick={()=>void remove(t)}><TbTrash size={16}/></Button></Tooltip>
              </Group>
            </Group>
          </Stack>
        </Card>
      })}</SimpleGrid>}
    <Card withBorder radius="md" padding="lg"><Group justify="space-between" mb="md"><Title order={4}>История резервного копирования</Title><Badge variant="light">Последние 150</Badge></Group><Table.ScrollContainer minWidth={760}><Table highlightOnHover><Table.Thead><Table.Tr><Table.Th>Дата</Table.Th><Table.Th>Хранилище</Table.Th><Table.Th>Статус</Table.Th><Table.Th>Размер</Table.Th><Table.Th>Архив</Table.Th><Table.Th>Действия</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{runs.map(r=><Table.Tr key={r.id}><Table.Td>{when(r.startedAt)}</Table.Td><Table.Td>{targets.find(t=>t.id===r.targetId)?.name??'Удалённое хранилище'}</Table.Td><Table.Td><Tooltip label={r.error??''} disabled={!r.error}><Badge color={statusColor(r.status)}>{r.deletedAt?'Удалён':statusName(r.status)}</Badge></Tooltip></Table.Td><Table.Td>{size(r.sizeBytes)}</Table.Td><Table.Td><Text ff="monospace" size="xs">{r.fileName??'—'}</Text>{r.deleteError&&<Text size="xs" c="red">{r.deleteError}</Text>}</Table.Td>
    <Table.Td>
      {r.status==='completed'&&!r.deletedAt&&<Tooltip label={latest(r.targetId)?.id===r.id?'Последний успешный архив защищён':r.deleteRequestedAt?'Ожидает удаления агентом':'Удалить физический архив'}>
        <Button color="red" size="compact-xs" variant="subtle" disabled={latest(r.targetId)?.id===r.id||!!r.deleteRequestedAt}
          onClick={()=>void removeRun(r)}>{r.deleteRequestedAt?'В очереди':'Удалить'}</Button>
      </Tooltip>}
    </Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>{runs.length===0&&<Text c="dimmed" size="sm">История появится после первого запуска агента.</Text>}</Card>
    <Modal opened={opened} onClose={()=>setOpened(false)} title={editing?'Настройки хранилища':'Новое хранилище'} centered size="lg"><Stack gap="md"><TextInput required label="Название" maxLength={70} placeholder="S3 — ежедневная копия" value={form.name} onChange={e=>setForm({...form,name:e.currentTarget.value})}/><Select label="Тип хранилища" required allowDeselect={false} data={Object.entries(providerLabel).map(([value,label])=>({value,label}))} value={form.provider} onChange={v=>setForm({...form,provider:(v??'local') as Provider})}/>{form.provider!=='local'&&<TextInput required label="Имя rclone remote" placeholder="my-s3" description="Подключение должно уже существовать в /etc/remnadrop-backups/rclone.conf на сервере." value={form.remoteName} onChange={e=>setForm({...form,remoteName:e.currentTarget.value})}/>}<TextInput label="Папка назначения" placeholder="remnadrop" description="Относительный путь без ../ (для local — подпапка резервного каталога)." value={form.remotePath} onChange={e=>setForm({...form,remotePath:e.currentTarget.value})}/>{form.provider === 'ftp' && <Alert color="yellow" title="О безопасности FTP">Обычный FTP передаёт данные без шифрования. Для резервных копий с персональными данными используйте FTPS или SFTP в настройке rclone.</Alert>}
            {form.provider === 'gdrive' && <Alert color="blue" title="Google Drive">Сначала настройте OAuth-доступ через rclone на сервере. Токены остаются в защищённом файле rclone.conf и не передаются в панель.</Alert>}
            <Divider label="Индивидуальное расписание"/><Select label="Периодичность" data={intervalLabels} value={String(form.intervalMinutes)} onChange={v=>{if(v)setForm({...form,intervalMinutes:Number(v)})}}/><NumberInput label="Или интервал вручную, минут" description="От 15 минут до 365 дней. Изменение не затрагивает расписания других хранилищ." min={15} max={525600} allowDecimal={false} value={form.intervalMinutes} onChange={v=>setForm({...form,intervalMinutes:Number(v)})}/><SimpleGrid cols={2}><NumberInput label="Хранить, дней" min={1} max={3650} allowDecimal={false} value={form.retentionDays} onChange={v=>setForm({...form,retentionDays:Number(v)})}/><NumberInput label="Ограничение, ГиБ" min={1} max={8388608} allowDecimal={false} value={Math.round(form.maxBytes/1073741824)} onChange={v=>setForm({...form,maxBytes:Number(v)*1073741824})}/></SimpleGrid><Switch label="Автоматически удалять старые копии" description="Удаление только копий, созданных этим инструментом и учтённых в его истории. Последняя успешная копия защищена." checked={form.autoDelete} onChange={e=>setForm({...form,autoDelete:e.currentTarget.checked})}/><Switch label="Отправлять вебхук" description="Отправлять уведомления о завершении и ошибках этого назначения." checked={form.webhookEnabled} onChange={e=>setForm({...form,webhookEnabled:e.currentTarget.checked})}/><Switch label="Хранилище включено" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.currentTarget.checked})}/><Group justify="end"><Button variant="default" onClick={()=>setOpened(false)}>Отмена</Button><Button loading={busy} disabled={!form.name.trim()||(form.provider!=='local'&&!form.remoteName.trim())||!Number.isSafeInteger(form.maxBytes)||form.maxBytes<1048576} onClick={()=>void save()}>Сохранить хранилище</Button></Group></Stack></Modal>
  </Stack></Page>
}
