package main

import (
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
 "time"

 "github.com/remnawave/limiter/internal/cache"
 "github.com/remnawave/limiter/internal/telegram"
)

type memoryPanelStore struct{ results map[string]string; persistent bool }
func(s *memoryPanelStore)PanelStates(context.Context,[]int64)(map[string]cache.PanelUserState,error){return map[string]cache.PanelUserState{"123":{Ignored:true}},nil}
func(s *memoryPanelStore)PanelWhitelist(context.Context)([]string,error){return []string{"123"},nil}
func(s *memoryPanelStore)PanelActionResult(_ context.Context,id string)(string,error){return s.results[id],nil}
func(s *memoryPanelStore)SavePanelActionResult(_ context.Context,id,fingerprint string,result any)error{
 raw,err:=json.Marshal(map[string]any{"fingerprint":fingerprint,"result":result});s.results[id]=string(raw);return err
}
func(s *memoryPanelStore)PanelPersistence(context.Context)(bool,error){return s.persistent,nil}
func(s *memoryPanelStore)PanelPendingRestores(context.Context)(int64,error){return 0,nil}
type memoryPanelSettings struct{calls int; values map[string]string}
func(s *memoryPanelSettings)Items()[]telegram.SettingItem{return nil}
func(s *memoryPanelSettings)ApplyMany(_ context.Context,v map[string]string)error{s.calls++;s.values=v;return nil}
func(s *memoryPanelSettings)Reset(context.Context,string)(string,error){return "",nil}
func(s *memoryPanelSettings)ResetAll(context.Context)error{return nil}

func panelTestHandler()(*panelControl,*int){
 calls:=new(int)
 p:=&panelControl{token:strings.Repeat("a",64),store:&memoryPanelStore{results:map[string]string{}},settings:&memoryPanelSettings{},lastCheck:func()time.Time{return time.Time{}},
 action:func(_ context.Context,_ telegram.Action)error{*calls++;return nil}}
 return p,calls
}
func panelTestRequest(p *panelControl,method,path,body,token string)*httptest.ResponseRecorder{
 req:=httptest.NewRequest(method,path,strings.NewReader(body));req.Header.Set("Authorization","Bearer "+token)
 res:=httptest.NewRecorder();p.ServeHTTP(res,req);return res
}
func TestPanelControlRequiresAuthentication(t *testing.T){
 p,calls:=panelTestHandler()
 for _,token:=range []string{"",strings.Repeat("b",64),p.token+"a"}{
  r:=panelTestRequest(p,http.MethodGet,"/health","",token)
  if r.Code!=401{t.Fatalf("unauthorized request got %d",r.Code)}
 }
 if *calls!=0{t.Fatal("unauthorized action executed")}
 r:=panelTestRequest(p,http.MethodGet,"/health","",p.token)
 if r.Code!=200||!strings.Contains(r.Body.String(),`"ready":true`){t.Fatalf("health: %s",r.Body.String())}
}
func TestPanelActionsDeduplicateAndRejectReusedID(t *testing.T){
 p,calls:=panelTestHandler()
 notifications:=0;p.notify=func(telegram.Action){notifications++}
 body:=`{"userId":123,"action":"disable_temp","minutes":1440,"requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`
 for i:=0;i<2;i++{if r:=panelTestRequest(p,http.MethodPost,"/actions",body,p.token);r.Code!=200{t.Fatalf("action failed: %s",r.Body.String())}}
 if *calls!=1{t.Fatalf("duplicate changed the restore timer: %d actions",*calls)}
 if notifications!=1{t.Fatalf("duplicate sent %d activity messages",notifications)}
 changed:=strings.Replace(body,`"minutes":1440`,`"minutes":30`,1)
 if r:=panelTestRequest(p,http.MethodPost,"/actions",changed,p.token);r.Code!=409{t.Fatalf("mismatched duplicate: %d",r.Code)}
 if *calls!=1{t.Fatal("mismatched duplicate executed")}
 if notifications!=1{t.Fatal("mismatched duplicate sent an activity message")}
}
func TestPanelRejectsInvalidActionsBeforeExecution(t *testing.T){
 p,calls:=panelTestHandler()
 bodies:=[]string{
  `{"userId":123,"action":"disable_temp","minutes":0,"requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`,
  `{"userId":123,"action":"enable","minutes":1,"requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`,
  `{"userId":-1,"action":"enable","requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`,
  `{"userId":123,"action":"delete","requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`,
  `{"userId":123,"action":"enable","extra":true,"requestId":"c57b867e-12a8-44e8-a1c6-4038755c5e52"}`,
  `{} {}`,
  strings.Repeat(" ",65537)+`{}`,
 }
 for _,body:=range bodies{if r:=panelTestRequest(p,http.MethodPost,"/actions",body,p.token);r.Code!=400{t.Fatalf("invalid action accepted: %d",r.Code)}}
 if *calls!=0{t.Fatal("invalid action reached user service")}
}
func TestPanelAutoSettingsRequirePersistence(t *testing.T){
 p,_:=panelTestHandler();settings:=p.settings.(*memoryPanelSettings)
 if r:=panelTestRequest(p,http.MethodPut,"/settings",`{"ACTION_MODE":"auto"}`,p.token);r.Code!=400{t.Fatal("auto accepted with volatile storage")}
 if settings.calls!=0{t.Fatal("unsafe settings persisted")}
 p.store.(*memoryPanelStore).persistent=true
 if r:=panelTestRequest(p,http.MethodPut,"/settings",`{"ACTION_MODE":"auto","COOLDOWN":"30"}`,p.token);r.Code!=200{t.Fatal("safe settings rejected")}
 if settings.calls!=1||settings.values["COOLDOWN"]!="30"{t.Fatal("batch settings were not applied together")}
}
