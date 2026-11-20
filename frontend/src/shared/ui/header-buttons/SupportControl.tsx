import { Badge, Box, Button, CopyButton, Divider, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { TbCheck, TbCopy, TbHeartFilled, TbShieldCheck } from 'react-icons/tb'
import { HeaderControl } from './HeaderControl'
import classes from './SupportControl.module.css'

const wallets = [
    { network: 'USDT TRC20', address: 'TCtfGkxkJkL9mkgsjZZF3EgfGXmwef1s4k' },
    { network: 'USDT TON/GRAM', address: 'UQDqHIVPOXiGn-wUfAKgRVt0zmqdQfe27xqjERTodzVNlrI-' },
    { network: 'USDT ERC20', address: '0x92A070d0a3bD4aDaBbF2d813deF474B7927307Bd' },
    { network: 'USDT SOL', address: 'DfsW41ujAW4YSAfFWHjAa1U7LjAp2Fceknn8YL5oj59X' },
    { network: 'USDT BEP20', address: '0x92A070d0a3bD4aDaBbF2d813deF474B7927307Bd' },
    { network: 'GRAM', address: 'UQBQBE2eo3PCixVX63rFelf9v-I8wxHg2qDRUmbkYMEYHf6b' }
] as const

function DonateDialog() {
    return <Stack gap="md">
        <Paper p="md" radius="lg" withBorder>
            <Group gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon color="pink" variant="light" size="xl" radius="lg"><TbHeartFilled size={22}/></ThemeIcon>
                <Box>
                    <Group gap="xs"><Text fw={700}>Поддержите развитие форка</Text><Badge color="teal" variant="light">RemnaDrop</Badge></Group>
                    <Text c="dimmed" size="sm" mt={4}>Пожертвования помогают поддерживать совместимость с Remnawave, исправлять ошибки и развивать открытые функции панели.</Text>
                </Box>
            </Group>
        </Paper>
        <SimpleGrid cols={{base: 1, sm: 2}} spacing="sm">
            {wallets.map(({network, address}) => <Paper key={network} withBorder radius="md" p="md">
                <Group justify="space-between" mb={8}><Text size="sm" fw={700}>{network}</Text><TbShieldCheck size={17} color="var(--mantine-primary-color-filled)"/></Group>
                <CopyButton value={address} timeout={1600}>
                    {({copied, copy})=><Tooltip label={copied?'Скопировано':'Нажмите, чтобы скопировать адрес'}>
                        <Button fullWidth variant="light" color={copied?'teal':'gray'} justify="space-between" px="xs" onClick={copy} rightSection={copied?<TbCheck size={17}/>:<TbCopy size={17}/>}
                            aria-label={`Скопировать адрес ${network}`}>
                            <Text truncate size="xs" ff="monospace" style={{maxWidth:'100%'}}>{address}</Text>
                        </Button>
                    </Tooltip>}
                </CopyButton>
            </Paper>)}
        </SimpleGrid>
        <Divider/>
        <Text size="xs" c="dimmed">Проверьте сеть перевода: TRC20, TON, ERC20, Solana и BEP20 не взаимозаменяемы. Нажатие на адрес копирует его в буфер обмена.</Text>
    </Stack>
}

export function SupportControl() {
    return <Tooltip label="Поддержать форк">
        <HeaderControl className={classes.support} aria-label="Поддержать форк" onClick={() => modals.open({title:'Поддержать RemnaDrop', size:'lg', centered:true, radius:'lg', children:<DonateDialog/>})}>
            <TbHeartFilled />
        </HeaderControl>
    </Tooltip>
}
