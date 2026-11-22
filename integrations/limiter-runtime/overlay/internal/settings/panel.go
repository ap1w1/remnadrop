package settings

import (
	"context"
	"fmt"
	"os"

	"github.com/remnawave/limiter/internal/config"
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
	if !ok{return fmt.Errorf("atomic settings persistence is unavailable")}
	if err:=store.ReplaceConfigOverrides(ctx,merged);err!=nil{return err}
	m.overrides=merged
	m.provider.Store(cfg)
	return nil
}

// A Telegram setting change must pass the same persistence guard as the panel.
func (m *Manager) ensurePanelPersistence(ctx context.Context,cfg *config.Config)error {
	if os.Getenv("REMNADROP_PANEL_CONTROL_SOCKET")==""||cfg.ActionMode!="auto" {return nil}
	store,ok:=m.cache.(interface{PanelPersistence(context.Context)(bool,error)})
	if !ok{return fmt.Errorf("Не удалось проверить сохранение состояния Limiter")}
	persistent,err:=store.PanelPersistence(ctx)
	if err!=nil{return err}
	if !persistent{return fmt.Errorf("Автоблокировка требует сохраняемого хранилища Limiter (AOF или RDB)")}
	return nil
}
