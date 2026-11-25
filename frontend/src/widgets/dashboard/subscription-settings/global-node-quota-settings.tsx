import { Alert, Button, Card, Group, MultiSelect, NumberInput, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { instance } from '@shared/api/axios'

type Policy = { periodDays: number | null; thresholdPercent: number; thresholdPercents:number[]; configured: boolean }
const choices=Array.from({length:99},(_,index)=>({value:String(index+1),label:`${index+1}%`}))

export function GlobalNodeQuotaSettings() {
    const [policy,setPolicy]=useState<Policy>({periodDays:null,thresholdPercent:80,thresholdPercents:[80],configured:false})
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
    const [message,setMessage]=useState('')
    const [failed,setFailed]=useState(false)
    useEffect(()=>{void instance.get('/api/node-quotas/global-settings').then(result=>{
        const value=result.data.response as Policy
        setPolicy({...value,thresholdPercents:value.thresholdPercents??[value.thresholdPercent??80]})
    }).catch(()=>{setFailed(true);setMessage('Не удалось загрузить настройки лимитов')}).finally(()=>setLoading(false))},[])
    const save=async()=>{
        setBusy(true);setMessage('');setFailed(false)
        try{
            const result=await instance.put('/api/node-quotas/global-settings',{
                periodDays:policy.periodDays,thresholdPercents:policy.thresholdPercents
            })
            setPolicy(result.data.response)
            setMessage('Правила применены ко всем пользователям. Расход трафика сохранён.')
        }catch{setFailed(true);setMessage('Не удалось сохранить настройки лимитов')}
        finally{setBusy(false)}
    }
    return <Card withBorder radius="md" mt="md" p="sm"><Stack gap="xs">
        <Group gap="xs" align="baseline" wrap="wrap"><Text fw={700}>Общие правила лимитов по нодам</Text><Text size="xs" c="dimmed">Для всех пользователей</Text></Group>
        {!loading&&<Group gap="sm" align="end" wrap="wrap">
            <NumberInput label="Сброс, дней" placeholder="Вручную" value={policy.periodDays??''}
                onChange={value=>setPolicy({...policy,periodDays:value===''?null:Number(value)})}
                min={1} max={366} allowDecimal={false} w={160}/>
            <MultiSelect label="Предупреждения при расходе" placeholder="Выберите проценты" searchable
                data={choices} value={policy.thresholdPercents.map(String)} maxValues={10} w={340}
                onChange={values=>setPolicy({...policy,thresholdPercents:values.map(Number).sort((a,b)=>a-b)})}/>
            <Button loading={busy} disabled={!policy.thresholdPercents.length||policy.periodDays!==null&&(policy.periodDays<1||policy.periodDays>366)} onClick={()=>void save()}>Применить ко всем</Button>
        </Group>}
        {message&&<Alert color={failed?'red':'teal'} p="xs">{message}</Alert>}
    </Stack></Card>
}
