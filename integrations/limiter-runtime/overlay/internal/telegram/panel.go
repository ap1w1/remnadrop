package telegram

import (
 "context"
 "fmt"
 "os"
 "strings"
 "github.com/sirupsen/logrus"
 "github.com/remnawave/limiter/internal/i18n"
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
  "drop":i18n.T("panel.activity.drop"),"disable":i18n.T("panel.activity.disable"),
  "disable_temp":fmt.Sprintf(i18n.T("panel.activity.disable_temp"),FormatDuration(a.Minutes)),"enable":i18n.T("panel.activity.enable"),
  "ignore":i18n.T("panel.activity.ignore"),
  "ignore_temp":fmt.Sprintf(i18n.T("panel.activity.ignore_temp"),FormatDuration(a.Minutes)),
  "unignore":i18n.T("panel.activity.unignore"),
 }
 label,ok:=labels[a.Name];if !ok{return nil}
 buttons:=undoRows(a.Name,a.UserID)
 if a.Name=="ignore"||a.Name=="ignore_temp"{buttons=[][]richButton{{cbButton(i18n.T("panel.activity.check_again"),actionData("unignore",a.UserID),styleNone)}}}
 body:=fmt.Sprintf(i18n.T("panel.activity.body"),a.UserID,escapeHTML(label))
 return b.sendMsg(ctx,richMsg{HTML:body,Rows:buttons})
}
