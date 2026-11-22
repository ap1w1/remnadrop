package panelbridge

import (
 "context"
 "sync"
 "testing"
 "time"
)

func TestPauseWaitsForInFlightDisableAndTimerBeforeCheckingQueue(t *testing.T){
 var gate mutationGate
 var queueMu sync.Mutex
 pending:=0
 release,ok:=gate.begin();if !ok{t.Fatal("initial disable denied")}
 stopped:=make(chan int,1)
 go func(){
  if err:=gate.pause(context.Background(),"stopping");err!=nil{panic(err)}
  queueMu.Lock();count:=pending;queueMu.Unlock();stopped<-count
 }()
 deadline:=time.Now().Add(time.Second)
 for gate.status()==""&&time.Now().Before(deadline){time.Sleep(time.Millisecond)}
 if _,ok:=gate.begin();ok{t.Fatal("new Telegram/panel/automatic disable crossed closed barrier")}
 select{case <-stopped:t.Fatal("stop checked queue before the in-flight timer write");default:}
 // Simulate a successful user disable followed by its required restore timer.
 queueMu.Lock();pending++;queueMu.Unlock();release()
 select{case count:=<-stopped:if count!=1{t.Fatal("stop missed the new restore timer")};case <-time.After(time.Second):t.Fatal("pause did not drain")}
 // A stop request can now refuse to stop and resume normal operation.
 gate.resume();release,ok=gate.begin();if !ok{t.Fatal("failed stop could not resume")};release()
}

func TestTimedOutPauseStaysClosedUntilExplicitResume(t *testing.T){
 var gate mutationGate
 release,_:=gate.begin()
 ctx,cancel:=context.WithCancel(context.Background());cancel()
 if err:=gate.pause(ctx,"stopping");err==nil{t.Fatal("cancelled pause succeeded")}
 if _,ok:=gate.begin();ok{t.Fatal("timeout silently reopened disable admission")}
 release();gate.resume()
 release,ok:=gate.begin();if !ok{t.Fatal("resume failed")};release();release()
 if err:=gate.pause(context.Background(),"stopping");err!=nil{t.Fatal(err)}
}
