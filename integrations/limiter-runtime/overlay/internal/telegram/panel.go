package telegram

import (
 "context"
 "fmt"
 "os"
 "strings"
 "github.com/sirupsen/logrus"
)

// NewSilentBot lets the panel operate while Telegram notifications are unconfigured.
// No Telegram requests are made by this instance.
func NewSilentBot(logger *logrus.Logger) *Bot {
	return &Bot{logger: logger, pending: make(map[int64]pendingInput)}
}

// This switch applies only to proactive messages. Command responses and edits
// of existing Telegram action messages deliberately continue to work.
func (b *Bot) NotificationsEnabled() bool {
 return !strings.EqualFold(os.Getenv("REMNADROP_TELEGRAM_NOTIFICATIONS"),"false")
}

func (b *Bot) SendPanelActivity(ctx context.Context,a Action)error {
 if !b.NotificationsEnabled()||b.api==nil{return nil}
 labels:=map[string]string{
  "drop":"Подключения сброшены","disable":"Подписка отключена бессрочно",
  "disable_temp":"Подписка отключена на "+FormatDuration(a.Minutes),"enable":"Подписка включена",
  "ignore":"Пользователь добавлен в постоянные исключения",
  "ignore_temp":"Пользователь добавлен в исключения на "+FormatDuration(a.Minutes),
  "unignore":"Пользователь удалён из исключений",
 }
 label,ok:=labels[a.Name];if !ok{return nil}
 buttons:=undoRows(a.Name,a.UserID)
 if a.Name=="ignore"||a.Name=="ignore_temp"{buttons=[][]richButton{{cbButton("Проверять снова",actionData("unignore",a.UserID),styleNone)}}}
 body:=fmt.Sprintf("<h3>Действие из панели</h3><p>Пользователь: <b>%d</b></p><p>%s</p>",a.UserID,escapeHTML(label))
 return b.sendMsg(ctx,richMsg{HTML:body,Rows:buttons})
}
