package panelbridge

import (
 "context"
 "sync"
)

// A pause closes admission before waiting for disable+restore-timer writes.
// Restoration is deliberately outside this gate and continues while paused.
type mutationGate struct {
 mu sync.Mutex
 reason string
 active int
 drained chan struct{}
}
var engineGate mutationGate

func(g *mutationGate)begin()(func(),bool){
 g.mu.Lock()
 if g.reason!=""{g.mu.Unlock();return nil,false}
 g.active++;g.mu.Unlock()
 var once sync.Once
 return func(){once.Do(func(){
  g.mu.Lock();defer g.mu.Unlock();g.active--
  if g.active==0&&g.drained!=nil{close(g.drained);g.drained=nil}
 })},true
}
func(g *mutationGate)pause(ctx context.Context,reason string)error{
 g.mu.Lock();g.reason=reason
 if g.active==0{g.mu.Unlock();return nil}
 if g.drained==nil{g.drained=make(chan struct{})}
 drained:=g.drained;g.mu.Unlock()
 select{case <-drained:return nil;case <-ctx.Done():return ctx.Err()}
}
func(g *mutationGate)resume(){g.mu.Lock();g.reason="";g.mu.Unlock()}
func(g *mutationGate)status()string{g.mu.Lock();defer g.mu.Unlock();return g.reason}
func StartPaused(){if Enabled(){_ = engineGate.pause(context.Background(),"startup")}}
func BeginDisable()(func(),bool){return engineGate.begin()}
func Pause(ctx context.Context)error{return engineGate.pause(ctx,"stopping")}
func Resume(){engineGate.resume()}
func PauseReason()string{return engineGate.status()}
func Paused()bool{return PauseReason()!=""}
