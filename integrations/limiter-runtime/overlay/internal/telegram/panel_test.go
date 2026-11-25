package telegram

import (
 "context"
 "strings"
 "testing"

 "github.com/sirupsen/logrus"
)

func TestPanelNotificationSwitchPreservesStatsAndCallbacks(t *testing.T){
 t.Setenv("REMNADROP_TELEGRAM_NOTIFICATIONS","false")
 bot,api:=newTestBot(t,100,0)
 ctx:=context.Background()
 calls:=[]func()error{
  func()error{return bot.SendManualAlert(ctx,"manual",77,1440,360)},
  func()error{return bot.SendAutoAlert(ctx,"automatic",77)},
  func()error{return bot.SendSoftAlert(ctx,"soft",77,360)},
  func()error{return bot.SendMessage(ctx,"restore")},
  func()error{return bot.SendDailyReport(ctx,"daily")},
  func()error{return bot.SendStartupMessage(ctx,"startup")},
  func()error{return bot.SendUpdateNotice(ctx,"5.1.0","5.2.0","https://github.com/syvlech/remnawave-limiter/releases/tag/v5.2.0")},
  func()error{return bot.SendPanelActivity(ctx,Action{Name:"disable_temp",UserID:77,Minutes:1440})},
 }
 for _,call:=range calls{if err:=call();err!=nil{t.Fatal(err)}}
 if len(api.find("sendRichMessage"))+len(api.find("sendMessage"))!=0{t.Fatal("muted automatic notification was sent")}
 if err:=bot.SendStats(ctx,"<h3>stats</h3>");err!=nil{t.Fatal(err)}
 if len(api.find("sendRichMessage"))!=1{t.Fatal("explicit statistics request was muted")}
 acted:=0;bot.SetActionHandler(func(context.Context,Action)error{acted++;return nil})
 bot.handleUpdate(ctx,nil,callbackUpdate(42,"disable:77"))
 if acted!=1||len(api.find("editMessageText"))!=1||len(api.find("answerCallbackQuery"))!=1{t.Fatal("existing Telegram action buttons stopped working")}
}

func TestPanelActivityNotificationContainsResultAndUndo(t *testing.T){
 t.Setenv("REMNADROP_TELEGRAM_NOTIFICATIONS","true")
 bot,api:=newTestBot(t,100,0)
 if err:=bot.SendPanelActivity(context.Background(),Action{Name:"disable_temp",UserID:77,Minutes:1440});err!=nil{t.Fatal(err)}
 calls:=api.find("sendRichMessage")
 if len(calls)!=1{t.Fatalf("expected one activity message, got %d",len(calls))}
 html:=richHTML(t,calls[0].fields)
 if !strings.Contains(html,"Действие из панели")||!strings.Contains(html,"77")||buttonData(html)!="enable:77"{t.Fatalf("incorrect activity: %s",html)}
 if err:=bot.SendPanelActivity(context.Background(),Action{Name:"ignore_temp",UserID:77,Minutes:360});err!=nil{t.Fatal(err)}
 if got:=buttonData(richHTML(t,api.find("sendRichMessage")[1].fields));got!="unignore:77"{t.Fatalf("temporary ignore has no undo: %s",got)}
}

func TestPanelOnlyHasNoTelegramRequirement(t *testing.T){
 t.Setenv("REMNADROP_TELEGRAM_NOTIFICATIONS","true")
 bot:=NewSilentBot(logrus.New())
 if err:=bot.SendPanelActivity(context.Background(),Action{Name:"enable",UserID:77});err!=nil{t.Fatal(err)}
 if err:=bot.SendManualAlert(context.Background(),"event",77,1440,360);err!=nil{t.Fatal(err)}
 bot.StartPolling(context.Background())
}
