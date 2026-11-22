#!/usr/bin/env python3
"""Apply the small RemnaDrop adapter to pinned upstream Limiter 5.1.0.

Every replacement is exact and counted. A changed upstream source fails the
build instead of silently disabling the panel/Telegram state integration.
"""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()
overlay = Path(__file__).resolve().parents[1] / 'integrations/limiter-runtime/overlay'

def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = root / path
    text = file.read_text()
    found = text.count(old)
    if found != count:
        raise SystemExit(f'Upstream mismatch: {path}: expected {count} anchors, found {found}')
    file.write_text(text.replace(old, new))

def add_import(path: str, name: str) -> None:
    anchor = 'import (\n'
    replace(path, anchor, anchor + '\t"' + name + '"\n')

replace('internal/config/config.go',
    '\ttelegramBotToken := l.lookup("TELEGRAM_BOT_TOKEN")\n\tif telegramBotToken == "" {',
    '\ttelegramBotToken := l.lookup("TELEGRAM_BOT_TOKEN")\n\tpanelOnly := l.lookup("REMNADROP_PANEL_CONTROL_SOCKET") != "" && telegramBotToken == ""\n\tif telegramBotToken == "" && !panelOnly {')
replace('internal/config/config.go',
    '\ttelegramChatIDStr := l.lookup("TELEGRAM_CHAT_ID")',
    '\ttelegramChatIDStr := l.lookup("TELEGRAM_CHAT_ID")\n\tif panelOnly { telegramChatIDStr = "0" }')
replace('internal/config/config.go',
    '\tif telegramAdminIDsStr == "" {', '\tif telegramAdminIDsStr == "" && !panelOnly {')
replace('internal/config/config.go',
    '\tif len(telegramAdminIDs) == 0 {', '\tif len(telegramAdminIDs) == 0 && !panelOnly {')

replace('internal/telegram/bot.go',
    'func (b *Bot) sendMsg(ctx context.Context, m richMsg) error {',
    'func (b *Bot) sendMsg(ctx context.Context, m richMsg) error {\n\tif b.api == nil { return nil }')
replace('internal/telegram/bot.go',
    'func (b *Bot) StartPolling(ctx context.Context) {',
    'func (b *Bot) StartPolling(ctx context.Context) {\n\tif b.api == nil { return }')

add_import('cmd/limiter/main.go','github.com/remnawave/limiter/internal/panelbridge')
replace('cmd/limiter/main.go',
    '\tbot, err := telegram.NewBot(cfg.TelegramBotToken, cfg.TelegramChatID, cfg.TelegramThreadID, cfg.TelegramAdminIDs, cfg.TelegramProxy, logger)',
    '\tvar bot *telegram.Bot\n\tif cfg.TelegramBotToken == "" && panelbridge.Enabled() {\n\t\tbot = telegram.NewSilentBot(logger)\n\t} else {\n\t\tbot, err = telegram.NewBot(cfg.TelegramBotToken, cfg.TelegramChatID, cfg.TelegramThreadID, cfg.TelegramAdminIDs, cfg.TelegramProxy, logger)\n\t}')
replace('cmd/limiter/main.go',
    '\tbot.SetActionHandler(newActionHandler(apiClient, redisCache, cfgProvider, logger))',
    '\tactionHandler := newPanelActionHandler(newActionHandler(apiClient, redisCache, cfgProvider, logger), redisCache, cfgProvider)\n\tbot.SetActionHandler(actionHandler)')
replace('cmd/limiter/main.go',
    '\tgo bot.StartPolling(sigCtx)',
    '\tif err := startPanelControl(sigCtx, redisCache, cfgProvider, settingsMgr, mon, trafficMon, actionHandler, logger); err != nil {\n\t\tlogger.WithError(err).Error("panel control startup failed")\n\t\treturn 1\n\t}\n\tgo bot.StartPolling(sigCtx)')
replace('cmd/limiter/main.go',
    '\tcfgProvider.Watch(func(c *config.Config) { applyLogSettings(logger, c) })',
    '\tpanelbridge.SetMode(cfg.ActionMode)\n\tcfgProvider.Watch(func(c *config.Config) {\n\t\tapplyLogSettings(logger, c)\n\t\tpanelbridge.SetMode(c.ActionMode)\n\t\tvalues := make(map[string]string)\n\t\tfor _, field := range config.Registry() { values[field.Key] = config.Display(c, field.Key) }\n\t\tpanelbridge.Emit(ctx, "settings_changed", nil, values)\n\t})')

# Preserve every observed node for each unique IP without changing device counting.
replace('internal/api/types.go',
    'type ActiveIP struct {\n',
    'type NodeConnection struct {\n\tNodeUUID string `json:"node_uuid"`\n\tNodeName string `json:"node_name"`\n\tLastSeen time.Time `json:"last_seen"`\n}\n\ntype ActiveIP struct {\n\tNodes []NodeConnection\n')
replace('internal/monitor/monitor.go',
    '\t\texisting, ok := uniqueMap[ip.IP]\n\t\tif !ok || ip.LastSeen.After(existing.LastSeen) {\n\t\t\tuniqueMap[ip.IP] = ip\n\t\t}',
    '\t\texisting, ok := uniqueMap[ip.IP]\n\t\tpeers := append(existing.Nodes, api.NodeConnection{NodeUUID:ip.NodeUUID, NodeName:ip.NodeName, LastSeen:ip.LastSeen})\n\t\tif !ok || ip.LastSeen.After(existing.LastSeen) {\n\t\t\tip.Nodes = peers\n\t\t\tuniqueMap[ip.IP] = ip\n\t\t} else {\n\t\t\texisting.Nodes = peers\n\t\t\tuniqueMap[ip.IP] = existing\n\t\t}')
replace('internal/webhook/types.go','import "time"','import (\n "time"\n "github.com/remnawave/limiter/internal/api"\n)')
replace('internal/webhook/types.go','type Payload struct {\n','type Payload struct {\n\tData any `json:"data,omitempty"`\n\tEvidence any `json:"evidence,omitempty"`\n')
replace('internal/webhook/types.go','type IPPayload struct {\n','type IPPayload struct {\n\tNodes []api.NodeConnection `json:"nodes,omitempty"`\n')
replace('internal/webhook/types.go','type ViolationPayload struct {\n','type ViolationPayload struct {\n\tConnectionCount int `json:"connection_count"`\n')
replace('internal/monitor/monitor.go','\tipPayloads := make([]webhook.IPPayload, len(ips))','\tconnectionCount := 0\n\tipPayloads := make([]webhook.IPPayload, len(ips))')
replace('internal/monitor/monitor.go','\t\tipPayloads[i] = webhook.IPPayload{','\t\tconnectionCount += len(ip.Nodes)\n\t\tipPayloads[i] = webhook.IPPayload{\n\t\t\tNodes: ip.Nodes,')
replace('internal/monitor/monitor.go','\t\tViolation: webhook.ViolationPayload{','\t\tViolation: webhook.ViolationPayload{\n\t\t\tConnectionCount: connectionCount,')
replace('internal/monitor/monitor.go','\t\tm.webhook.Send(sendCtx, payload)','\t\tif panelbridge.Enabled() { payload.Evidence = m.collectEvidence(sendCtx, user.UserID, ips) }\n\t\tm.webhook.Send(sendCtx, payload)')

for path in ['internal/monitor/monitor.go','internal/traffic/traffic.go','internal/hwidshare/hwidshare.go']:
    add_import(path,'github.com/remnawave/limiter/internal/panelbridge')
replace('internal/traffic/traffic.go',
    '\t\ttext := telegram.FormatTrafficAlert(alert, m.location)',
    '\t\teventType := "traffic_spike"\n\t\tif alert.Heavy { eventType = "traffic_heavy" }\n\t\tpanelbridge.Emit(ctx, eventType, alert.User, alert)\n\t\ttext := telegram.FormatTrafficAlert(alert, m.location)')
replace('internal/hwidshare/hwidshare.go',
    '\ttext := telegram.FormatSharedHWIDAlert(alert, m.location)',
    '\tpanelbridge.Emit(ctx, "shared_hwid", alert.User, alert)\n\ttext := telegram.FormatSharedHWIDAlert(alert, m.location)')
replace('internal/monitor/monitor.go',
    '\ttext := telegram.FormatDailyReport(stats, m.location, heavy)',
    '\tpanelbridge.Emit(ctx, "daily_report", nil, map[string]any{"violations":stats,"heavyTraffic":heavy})\n\ttext := telegram.FormatDailyReport(stats, m.location, heavy)')
replace('internal/monitor/monitor.go',
    '\ttext := telegram.FormatAutoAlert(user, ips, limit, disabledFor, violationCount, m.location, subnetGroups, cfg.SubnetGrouping, asnGroups, cfg.ASNGrouping, ev)',
    '\tname := "disable"\n\tif disabledFor > 0 { name = "disable_temp" }\n\tpanelbridge.Emit(ctx, "action", user, map[string]any{"action":name,"minutes":disabledFor,"source":"auto","success":true})\n\ttext := telegram.FormatAutoAlert(user, ips, limit, disabledFor, violationCount, m.location, subnetGroups, cfg.SubnetGrouping, asnGroups, cfg.ASNGrouping, ev)')
replace('internal/monitor/monitor.go',
    '\tm.logger.WithField("userID", userID).Info(i18n.T("log.user_restored"))',
    '\tm.logger.WithField("userID", userID).Info(i18n.T("log.user_restored"))\n\tpanelbridge.Emit(ctx, "action", &api.CachedUser{UserID:userID}, map[string]any{"action":"enable","source":"restore","success":true})')

# Telegram settings and resets share the same durability requirement as panel edits.
replace('internal/settings/manager.go',
    '\tnewCfg, err := config.LoadConfigWithOverrides(m.envPath, merged)\n\tif err != nil {\n\t\treturn "", err\n\t}',
    '\tnewCfg, err := config.LoadConfigWithOverrides(m.envPath, merged)\n\tif err != nil {\n\t\treturn "", err\n\t}\n\tif err := m.ensurePanelPersistence(ctx, newCfg); err != nil { return "", err }', count=2)
replace('internal/settings/manager.go',
    '\tnewCfg, err := config.LoadConfigWithOverrides(m.envPath, nil)\n\tif err != nil {\n\t\treturn err\n\t}',
    '\tnewCfg, err := config.LoadConfigWithOverrides(m.envPath, nil)\n\tif err != nil {\n\t\treturn err\n\t}\n\tif err := m.ensurePanelPersistence(ctx, newCfg); err != nil { return err }')
replace('internal/monitor/monitor.go',
    '\t\tif attempts < maxRestoreAttempts {',
    '\t\tpanelbridge.Emit(ctx, "action", &api.CachedUser{UserID:userID}, map[string]any{"action":"enable","source":"restore","success":false,"message":fmt.Sprintf("Не удалось включить подписку автоматически. Попытка %d из %d.", attempts, maxRestoreAttempts)})\n\t\tif attempts < maxRestoreAttempts {')
replace('internal/monitor/monitor.go',
    '\t\tm.logger.WithError(err).WithField("userID", user.UserID).Error(i18n.T("log.user_disable_failed"))',
    '\t\tm.logger.WithError(err).WithField("userID", user.UserID).Error(i18n.T("log.user_disable_failed"))\n\t\tpanelbridge.Emit(ctx, "action", user, map[string]any{"action":"disable","source":"auto","success":false,"message":"Не удалось отключить подписку автоматически"})')
add_import('internal/updatecheck/updatecheck.go','github.com/remnawave/limiter/internal/panelbridge')
replace('internal/updatecheck/updatecheck.go',
    '\tif err := c.Notifier.SendUpdateNotice(ctx, c.Current, rel.Version, rel.URL); err != nil {',
    '\tpanelbridge.Emit(ctx, "update_available", nil, map[string]any{"current":c.Current,"latest":rel.Version,"url":rel.URL})\n\tif err := c.Notifier.SendUpdateNotice(ctx, c.Current, rel.Version, rel.URL); err != nil {')

for source in overlay.rglob('*.go'):
    destination=root/source.relative_to(overlay)
    if destination.exists():
        raise SystemExit(f'Adapter file would overwrite upstream file: {destination}')
    destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,destination)

print('RemnaDrop panel adapter applied to Limiter 5.1.0')
