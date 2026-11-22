package settings

import (
	"context"
	"errors"
	"os"

	"github.com/remnawave/limiter/internal/config"
	"github.com/remnawave/limiter/internal/i18n"
)

// ApplyMany validates one coherent configuration before atomically persisting it.
// This avoids rejecting two dependent threshold changes in an arbitrary order.
func (m *Manager) ApplyMany(ctx context.Context,values map[string]string)error {
	m.mu.Lock();defer m.mu.Unlock()
	merged:=m.cloneOverrides()
	for key,value:=range values {
		if err:=config.ValidateRaw(key,value);err!=nil{return err}
		merged[key]=value
	}
	cfg,err:=config.LoadConfigWithOverrides(m.envPath,merged)
	if err!=nil{return err}
	if err:=m.ensurePanelPersistence(ctx,cfg);err!=nil{return err}
	store,ok:=m.cache.(interface{ReplaceConfigOverrides(context.Context,map[string]string)error})
	if !ok{return errors.New(i18n.T("error.panel.atomic_settings_unavailable"))}
	if err:=store.ReplaceConfigOverrides(ctx,merged);err!=nil{return err}
	m.overrides=merged
	m.provider.Store(cfg)
	return nil
}

// A Telegram setting change must pass the same persistence guard as the panel.
func (m *Manager) ensurePanelPersistence(ctx context.Context,cfg *config.Config)error {
	if os.Getenv("REMNADROP_PANEL_CONTROL_SOCKET")==""||cfg.ActionMode!="auto" {return nil}
	store,ok:=m.cache.(interface{PanelPersistence(context.Context)(bool,error)})
	if !ok{return errors.New(i18n.T("error.panel.persistence_check_failed"))}
	persistent,err:=store.PanelPersistence(ctx)
	if err!=nil{return err}
	if !persistent{return errors.New(i18n.T("error.panel.auto_block_persistence"))}
	return nil
}
