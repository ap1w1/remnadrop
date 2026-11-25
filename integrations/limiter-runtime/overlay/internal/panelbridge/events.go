// Package panelbridge adds a private event mirror for the RemnaDrop panel.
// Upstream detection and Telegram behaviour remain the source of truth.
package panelbridge

import (
	"context"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/remnawave/limiter/internal/api"
	"github.com/remnawave/limiter/internal/webhook"
)

func Enabled() bool { return os.Getenv("REMNADROP_PANEL_CONTROL_SOCKET") != "" }
var actionMode atomic.Value
func SetMode(mode string) { actionMode.Store(mode) }

// Emit mirrors structured alerts independently of whether Telegram is configured.
// The same signed, retrying transport as upstream device-limit events is used.
func Emit(ctx context.Context, event string, user *api.CachedUser, data any) {
	if !Enabled() || os.Getenv("WEBHOOK_URL") == "" { return }
	mode:=os.Getenv("ACTION_MODE");if current,ok:=actionMode.Load().(string);ok{mode=current}
	p := &webhook.Payload{Event:event, ActionMode:mode, Timestamp:time.Now(), Data:data}
	if user != nil {
		p.User = webhook.UserPayload{UserID:user.UserID, Username:user.Username, SubscriptionURL:user.SubscriptionURL}
		if p.User.Username == "" { p.User.Username = strconv.FormatInt(user.UserID,10) }
	}
	client := webhook.NewClient(os.Getenv("WEBHOOK_URL"), os.Getenv("WEBHOOK_SECRET"), logrus.New())
	client.SetRawSecretHeader(false)
	go func() {
		sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
		defer cancel()
		client.Send(sendCtx,p)
	}()
}
