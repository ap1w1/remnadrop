package telegram

import "github.com/sirupsen/logrus"

// NewSilentBot lets the panel operate while Telegram notifications are unconfigured.
// No Telegram requests are made by this instance.
func NewSilentBot(logger *logrus.Logger) *Bot {
	return &Bot{logger: logger, pending: make(map[int64]pendingInput)}
}
