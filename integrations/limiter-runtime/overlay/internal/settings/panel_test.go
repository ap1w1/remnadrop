package settings

import (
 "context"
 "errors"
 "testing"

 "github.com/remnawave/limiter/internal/config"
)
type atomicPanelStore struct{values map[string]string; writes int; fail bool}
func(s *atomicPanelStore)SetConfigOverride(context.Context,string,string)error{return errors.New("must use atomic write")}
func(s *atomicPanelStore)DeleteConfigOverride(context.Context,string)error{return nil}
func(s *atomicPanelStore)ClearConfigOverrides(context.Context)error{return nil}
func(s *atomicPanelStore)ReplaceConfigOverrides(_ context.Context,values map[string]string)error{
 if s.fail{return errors.New("persistence unavailable")};s.values=values;s.writes++;return nil
}
func TestPanelSettingsBatchIsValidatedAndCommittedAtomically(t *testing.T){
 for key,value:=range map[string]string{"REMNAWAVE_API_URL":"https://panel.example.com","REMNAWAVE_API_TOKEN":"test-key",
  "TELEGRAM_BOT_TOKEN":"123456:ABC-DEF","TELEGRAM_CHAT_ID":"1","TELEGRAM_ADMIN_IDS":"1",
  "COOLDOWN":"300","CHECK_INTERVAL":"60","VIOLATION_THRESHOLD":"3","VIOLATION_THRESHOLD_WINDOW":"3600",
  "REMNADROP_PANEL_CONTROL_SOCKET":""}{t.Setenv(key,value)}
 cfg,err:=config.LoadConfig("");if err!=nil{t.Fatal(err)}
 provider:=config.NewProvider(cfg);store:=&atomicPanelStore{};mgr:=NewManager(provider,store,"",nil)
 changes:=0;provider.Watch(func(*config.Config){changes++})
 // These dependent values are valid as one configuration, not as an arbitrary sequence.
 if err:=mgr.ApplyMany(context.Background(),map[string]string{"COOLDOWN":"10","CHECK_INTERVAL":"1","VIOLATION_THRESHOLD_WINDOW":"30"});err!=nil{t.Fatal(err)}
 if provider.Load().Cooldown!=10||provider.Load().ViolationThresholdWindow!=30||store.writes!=1||changes!=1{t.Fatal("batch not committed exactly once")}
 if err:=mgr.ApplyMany(context.Background(),map[string]string{"CHECK_INTERVAL":"0"});err==nil{t.Fatal("invalid interval accepted")}
 if store.writes!=1||changes!=1||provider.Load().CheckInterval!=1{t.Fatal("invalid batch changed state")}
 store.fail=true
 if err:=mgr.ApplyMany(context.Background(),map[string]string{"COOLDOWN":"11"});err==nil{t.Fatal("failed persistence accepted")}
 if provider.Load().Cooldown!=10||changes!=1{t.Fatal("failed persistence changed live settings")}
}
