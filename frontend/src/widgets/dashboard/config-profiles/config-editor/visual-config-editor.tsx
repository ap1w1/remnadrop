import { ActionIcon, Alert, Badge, Button, Card, Group, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { TbCopy, TbPlus, TbTrash } from 'react-icons/tb'
import { VisualInboundFields } from './visual-inbound-fields'
import { VisualRoutingFields } from './visual-routing-fields'

type JsonObject = Record<string, unknown>
type Props = { config: JsonObject; onChange: (next: JsonObject) => void }
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const inboundList = (config: JsonObject): JsonObject[] => Array.isArray(config.inbounds)
    ? config.inbounds.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as JsonObject[] : []
const outboundList = (config: JsonObject): JsonObject[] => Array.isArray(config.outbounds)
    ? config.outbounds.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as JsonObject[] : []

/** Field editing is deliberately lossless: unrepresented Xray keys are preserved verbatim. */
export function VisualConfigEditor({ config, onChange }: Props) {
    const inbounds = inboundList(config)
    const outbounds = outboundList(config)
    const patchInbound = (index: number, changes: JsonObject) => {
        const next = [...inbounds]
        next[index] = { ...next[index], ...changes }
        onChange({ ...config, inbounds: next })
    }
    const patchOutbound = (index: number, changes: JsonObject) => {
        const next = [...outbounds]
        next[index] = { ...next[index], ...changes }
        onChange({ ...config, outbounds: next })
    }
    const duplicateInbound = (index: number) => {
        const next = [...inbounds]
        const copy = structuredClone(next[index])
        copy.tag = String(copy.tag ?? 'inbound') + '-copy'
        next.splice(index + 1, 0, copy)
        onChange({ ...config, inbounds: next })
    }
    const addInbound = () => {
        const next = [...inbounds, {
            tag: 'VLESS-' + (inbounds.length + 1),
            listen: '0.0.0.0', port: 443, protocol: 'vless',
            settings: { clients: [], decryption: 'none' },
        }]
        onChange({ ...config, inbounds: next })
    }
    return <ScrollArea style={{ height: '100%', width: '100%' }} p="md">
        <Stack gap="lg">
            <div>
                <Title order={4}>Визуальный редактор Xray</Title>
                <Text c="dimmed" size="sm">Конструктор входящих подключений, VLESS, REALITY, TLS, xHTTP, WebSocket, gRPC, маршрутизации и исходящих тегов. Неотображаемые поля сохраняются в JSON.</Text>
            </div>
            <Alert color="yellow" variant="light">
                Изменения попадут в JSON и пройдут штатную проверку Xray перед сохранением. Для сложных протоколов и расширенных параметров переключитесь на вкладку JSON.
            </Alert>
            <Card withBorder radius="md" p="md">
                <Stack gap="xs">
                    <Text fw={650}>Журнал Xray</Text>
                    <Select label="Уровень логирования" allowDeselect={false}
                        value={typeof object(config.log).loglevel === 'string' ? String(object(config.log).loglevel) : 'warning'}
                        data={['none','error','warning','info','debug'].map(value=>({value,label:value}))}
                        onChange={value=>onChange({ ...config, log: { ...object(config.log), loglevel: value || 'warning' } })}/>
                </Stack>
            </Card>
            <Group justify="space-between">
                <div><Text fw={700}>Входящие подключения</Text><Text c="dimmed" size="xs">Inbound · {inbounds.length}</Text></div>
                <Button size="sm" variant="light" leftSection={<TbPlus size={16}/>} onClick={addInbound}>Добавить VLESS</Button>
            </Group>
            {inbounds.map((inbound, index) => <Card key={index} withBorder radius="md" p="md">
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs"><Text fw={650}>{String(inbound.tag ?? 'Inbound ' + (index + 1))}</Text><Badge variant="light">{String(inbound.protocol ?? 'неизвестно')}</Badge></Group>
                        <Group gap={4} wrap="nowrap">
                            <ActionIcon variant="subtle" aria-label={'Клонировать inbound ' + (index + 1)} onClick={()=>duplicateInbound(index)}><TbCopy size={17}/></ActionIcon>
                            <ActionIcon color="red" variant="subtle" aria-label={'Удалить inbound ' + (index + 1)} onClick={()=>{
                                if (!window.confirm('Удалить этот inbound из конфигурации? Ноды, которые его используют, могут потерять подключение.')) return
                                onChange({ ...config, inbounds: inbounds.filter((_, i)=>i!==index) })
                            }}><TbTrash size={17}/></ActionIcon>
                        </Group>
                    </Group>
                    <SimpleGrid cols={{base:1,sm:2}}>
                        <TextInput label="Тег inbound" value={String(inbound.tag ?? '')}
                            onChange={e=>patchInbound(index,{tag:e.currentTarget.value})}/>
                        <TextInput label="Адрес прослушивания" description="Например, 0.0.0.0 или 127.0.0.1"
                            value={String(inbound.listen ?? '')}
                            onChange={e=>patchInbound(index,{listen:e.currentTarget.value})}/>
                        <NumberInput label="Порт" min={1} max={65535} clampBehavior="strict" allowDecimal={false}
                            value={typeof inbound.port === 'number' ? inbound.port : ''}
                            disabled={typeof inbound.port === 'string'}
                            description={typeof inbound.port === 'string' ? 'Нестандартный диапазон: измените в JSON' : undefined}
                            onChange={value=>{if (typeof value === 'number') patchInbound(index,{port:value})}}/>
                        <TextInput label="Протокол" readOnly value={String(inbound.protocol ?? '')}
                            description="Для изменения протокола используйте JSON"/>
                    </SimpleGrid>
                    <VisualInboundFields inbound={inbound} onChange={value=>patchInbound(index,value)}/>
                </Stack>
            </Card>)}
            <Text fw={700}>Исходящие подключения · {outbounds.length}</Text>
            {outbounds.map((outbound,index)=><Card key={index} withBorder p="md" radius="md">
                <SimpleGrid cols={{base:1,sm:2}}>
                    <TextInput label="Тег outbound" value={String(outbound.tag ?? '')}
                        onChange={e=>patchOutbound(index,{tag:e.currentTarget.value})}/>
                    <TextInput label="Протокол" readOnly value={String(outbound.protocol ?? '')}/>
                </SimpleGrid>
            </Card>)}
            <VisualRoutingFields config={config} onChange={onChange}/>
            <Text c="dimmed" size="xs">Сложные исходящие VLESS-подключения, сертификаты, расширенные правила DNS и неизвестные Xray-ключи не переписываются. Для их изменения остаётся режим JSON.</Text>
        </Stack>
    </ScrollArea>
}
