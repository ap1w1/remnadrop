import { Badge, Box, Button, Card, Group, Stack, Text } from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TbArrowsMaximize, TbFocus2, TbHandMove, TbMinus, TbPlus, TbX } from 'react-icons/tb'

export type GraphVertex = {id:string;kind:'node'|'profile'|'inbound'|'squad'|'host';label:string;detail:string;disabled?:boolean;hidden?:boolean;status?:string}
export type GraphEdge = {from:string;to:string}
type Pt = {x:number;y:number}
type Props = {vertices:GraphVertex[];edges:GraphEdge[]}
const WIDTH=198, HEIGHT=62, ROW=78, COLUMN=238
const palette:Record<GraphVertex['kind'],{fill:string;stroke:string}> = {
  node:{fill:'#143d45',stroke:'#17b4c0'},
  profile:{fill:'#24324b',stroke:'#718acb'},
  inbound:{fill:'#34304a',stroke:'#a18bf0'},
  squad:{fill:'#3a303e',stroke:'#dc91c9'},
  host:{fill:'#2b3a39',stroke:'#54a996'}
}
const kindLabel:Record<GraphVertex['kind'],string>={node:'Нода',profile:'Профиль',inbound:'Inbound',squad:'Сквад',host:'Хост'}
const truncate=(value:string,max:number)=>value.length>max?value.slice(0,max-1)+'…':value

/** Pan, zoom, drag, focus and follow node/profile/squad/inbound/host relations. */
export function TopologyCanvas({vertices,edges}:Props) {
  const [zoom,setZoom]=useState(1)
  const [fullScreen,setFullScreen]=useState(false)
  const [pan,setPan]=useState<Pt>({x:25,y:32})
  const [selected,setSelected]=useState<string|null>(null)
  const [offsets,setOffsets]=useState<Record<string,Pt>>({})
  const viewport=useRef<HTMLDivElement>(null)
  const [viewportWidth,setViewportWidth]=useState(1250)
  useEffect(()=>{
    if(!viewport.current)return
    const observer=new ResizeObserver(entries=>setViewportWidth(entries[0]?.contentRect.width??1250))
    observer.observe(viewport.current)
    return ()=>observer.disconnect()
  },[])
  const dragging=useRef<{id:string|null;point:Pt;startPan:Pt;startOffset:Pt}|null>(null)
  const base=useMemo(()=>{
    const counts:Record<string,number>={}
    for(const v of vertices)counts[v.kind]=(counts[v.kind]??0)+1
    const next:Record<string,number>={}
    const positions=new Map<string,Pt>()
    const max=Math.max(1,...Object.values(counts))
    for(const v of vertices){
      const index=next[v.kind]??0
      next[v.kind]=index+1
      const column={node:0,profile:1,squad:2,inbound:3,host:4}[v.kind]
      const count=counts[v.kind]??1
      positions.set(v.id,{x:column*COLUMN,y:(max-count)*ROW/2+index*ROW})
    }
    return positions
  },[vertices])
  const maxRows=Math.max(1,...Object.values(vertices.reduce<Record<string,number>>((counts,v)=>{
    counts[v.kind]=(counts[v.kind]??0)+1
    return counts
  },{})))
  const graphWidth=Math.max(1250,...vertices.map(v=>(base.get(v.id)?.x??0)+(offsets[v.id]?.x??0)+WIDTH+80))
  const graphHeight=Math.max(680,maxRows*ROW+90,...vertices.map(v=>(base.get(v.id)?.y??0)+(offsets[v.id]?.y??0)+HEIGHT+80))
  const canvasWidth=Math.ceil(Math.max(viewportWidth,graphWidth*zoom+Math.max(0,pan.x)))
  const canvasHeight=Math.ceil(Math.max(680,graphHeight*zoom+Math.max(0,pan.y)))
  const position=(id:string)=>{
    const p=base.get(id)??{x:0,y:0},delta=offsets[id]??{x:0,y:0}
    return {x:p.x+delta.x,y:p.y+delta.y}
  }
  const active=vertices.find(v=>v.id===selected)
  const chain=useMemo(()=>{
    const selectedIds=new Set<string>()
    if(!selected||!vertices.some(v=>v.id===selected))return selectedIds
    selectedIds.add(selected)
    const queue=[selected]
    while(queue.length){
      const current=queue.shift()!
      for(const edge of edges){
        if(edge.to===current&&!selectedIds.has(edge.from)){selectedIds.add(edge.from);queue.push(edge.from)}
      }
    }
    return selectedIds
  },[selected,vertices,edges])
  const onPointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(e.button!==0)return
    e.preventDefault()
    const target=e.target as Element
    const id=target.closest('[data-vertex]')?.getAttribute('data-vertex')??null
    const origin=id?offsets[id]??{x:0,y:0}:pan
    dragging.current={id,point:{x:e.clientX,y:e.clientY},startPan:pan,startOffset:origin}
    setSelected(id)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{
    const drag=dragging.current
    if(!drag)return
    const dx=e.clientX-drag.point.x,dy=e.clientY-drag.point.y
    if(drag.id){
      const id=drag.id
      setOffsets(prev=>({...prev,[id]:{x:drag.startOffset.x+dx/zoom,y:drag.startOffset.y+dy/zoom}}))
    }else{
      setPan({x:drag.startPan.x+dx,y:drag.startPan.y+dy})
    }
  }
  const onPointerUp=(e:React.PointerEvent<SVGSVGElement>)=>{
    dragging.current=null
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const focus=()=>{setOffsets({});setPan({x:25,y:32});setZoom(1);setSelected(null)}
  const changeZoom=(delta:number)=>setZoom(value=>Math.min(2.25,Math.max(.45,Math.round((value+delta)*100)/100)))
  return <Card withBorder radius="lg" padding="md" style={fullScreen?{position:'fixed',inset:10,zIndex:2000,overflow:'auto',background:'var(--mantine-color-body)'}:undefined}>
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <div><Text fw={700}>Интерактивный холст связей</Text><Text c="dimmed" size="xs">Нажмите на объект для выделения его цепочки; перетаскивайте карточки и масштабируйте холст</Text></div>
        <Group gap="xs"><Button size="compact-sm" variant="light" leftSection={<TbMinus size={15}/>} aria-label="Уменьшить масштаб" onClick={()=>changeZoom(-.2)}>−</Button><Badge variant="light">{Math.round(zoom*100)}%</Badge><Button size="compact-sm" variant="light" leftSection={<TbPlus size={15}/>} aria-label="Увеличить масштаб" onClick={()=>changeZoom(.2)}>+</Button><Button size="compact-sm" variant="default" leftSection={<TbFocus2 size={16}/>} onClick={focus}>Сброс</Button><Button size="compact-sm" variant="default" leftSection={fullScreen?<TbX size={16}/>:<TbArrowsMaximize size={16}/>} onClick={()=>setFullScreen(value=>!value)}>{fullScreen?'Закрыть':'На весь экран'}</Button></Group>
      </Group>
      <Box ref={viewport} style={{border:'1px solid var(--mantine-color-default-border)',borderRadius:12,overflow:'auto',maxHeight:fullScreen?'calc(100vh - 150px)':'82vh',background:'#121820'}}>
        <svg xmlns="http://www.w3.org/2000/svg" width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          aria-label="Схема нод, профилей, сквадов, inbound и хостов со связями" role="group"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onWheel={e=>{if(e.ctrlKey||e.altKey||e.shiftKey)return;e.preventDefault();changeZoom(e.deltaY>0?-.08:.08)}}
          style={{touchAction:'none',userSelect:'none',WebkitUserSelect:'none',cursor:dragging.current?.id?'grabbing':'grab'}}>
          <defs>
            <pattern id="remnadrop-topology-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#35414a" opacity=".55"/></pattern>
            <marker id="remnadrop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#6b8298"/></marker>
          </defs>
          <rect width={canvasWidth} height={canvasHeight} fill="url(#remnadrop-topology-grid)"/>
          <g transform={'translate('+pan.x+' '+pan.y+') scale('+zoom+')'}>
            {edges.map((edge,i)=>{
              const start=position(edge.from),end=position(edge.to)
              const activeEdge=chain.has(edge.from)&&chain.has(edge.to)
              return <path key={edge.from+'-'+edge.to+'-'+i}
                d={'M'+(start.x+WIDTH)+' '+(start.y+HEIGHT/2)+' C'+(start.x+WIDTH+44)+' '+(start.y+HEIGHT/2)+','+(end.x-44)+' '+(end.y+HEIGHT/2)+','+end.x+' '+(end.y+HEIGHT/2)}
                stroke={activeEdge?'#46d3d5':'#617588'} strokeWidth={activeEdge?2.8:1.6} strokeOpacity={selected&&!activeEdge?.2:1}
                fill="none" markerEnd="url(#remnadrop-arrow)" vectorEffect="non-scaling-stroke"/>
            })}
            {vertices.map(v=>{
              const p=position(v.id),paint=palette[v.kind],active=selected===v.id,inChain=chain.has(v.id)
              return <g key={v.id} data-vertex={v.id} transform={'translate('+p.x+' '+p.y+')'}
                role="button" aria-label={kindLabel[v.kind]+': '+v.label+(v.status?' · '+v.status:'')} tabIndex={0}
                onFocus={()=>setSelected(v.id)}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(v.id)}}}
                opacity={selected&&!inChain?.3:1} style={{cursor:'move',outline:'none'}}>
                  <rect width={WIDTH} height={HEIGHT} rx={14} fill={paint.fill}
                    stroke={active?'#ffffff':inChain?'#46d3d5':v.status==='Нет связи'||v.disabled?'#ad6565':v.hidden?'#a78bfa':paint.stroke}
                    strokeWidth={active?2.8:inChain?2.2:1.4}/>
                  <rect x="12" y="10" width="7" height="18" rx="3" fill={paint.stroke}/>
                  <text x="28" y="24" fontSize="11" fontWeight="600" fill={v.status==='Нет связи'?'#f3a7a7':'#bbccd9'}>{kindLabel[v.kind].toUpperCase()}{v.status?' · '+v.status.toUpperCase():v.kind==='host'&&v.hidden?' · СКРЫТ':v.disabled?' · ОТКЛЮЧЁН':''}</text>
                  <text x="14" y="40" fontSize="13" fontWeight="650" fill="#ffffff">{truncate(v.label,23)}</text>
                  <text x="14" y="55" fontSize="10" fill="#b5c4d2">{truncate(v.detail,28)}</text>
                  {v.kind==='host'&&v.hidden&&<g transform="translate(167 9)" fill="none" stroke="#c4b5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l19 19M3.8 8.7C7.8 3.8 15 3 19 9c1 1.2 1.8 2.2 2 2.7-1.5 3.3-5 6.2-9 6.2a10 10 0 0 1-3.4-.6M3 10.7a13 13 0 0 0-1 1c.8 1.8 2.2 3.4 4 4.6"/></g>}
              </g>
            })}
          </g>
        </svg>
      </Box>
      <Group gap="xs" wrap="wrap"><TbHandMove size={16}/><Text c="dimmed" size="xs">Карточек: {vertices.length}, связей: {edges.length}{active?`, в цепочке: ${chain.size}`:''}. Выбор не изменяет настройки панели.</Text></Group>
      {active&&<Card withBorder radius="md" padding="sm"><Group justify="space-between" wrap="wrap"><div><Text fw={700}>{active.label}</Text><Text c="dimmed" size="xs">{kindLabel[active.kind]} · {active.detail}</Text></div><Badge color={active.status==='Онлайн'?'teal':active.status==='Нет связи'||active.disabled?'red':active.hidden?'violet':'cyan'} variant="light">{active.status??(active.disabled?'Отключён':active.hidden?'Скрыт':'В цепочке')}</Badge></Group></Card>}
    </Stack>
  </Card>
}
