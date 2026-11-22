package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/remnawave/limiter/internal/api"
	"github.com/remnawave/limiter/internal/cache"
	"github.com/remnawave/limiter/internal/config"
	"github.com/remnawave/limiter/internal/i18n"
	"github.com/remnawave/limiter/internal/monitor"
	"github.com/remnawave/limiter/internal/panelbridge"
	"github.com/remnawave/limiter/internal/settings"
	"github.com/remnawave/limiter/internal/telegram"
	"github.com/remnawave/limiter/internal/traffic"
)

type panelSourceKey struct{}
type panelRequestKey struct{}
type panelSettings interface {
	Items() []telegram.SettingItem
	ApplyMany(context.Context,map[string]string) error
	Reset(context.Context,string)(string,error)
	ResetAll(context.Context)error
}
type panelStore interface {
	PanelStates(context.Context,[]int64)(map[string]cache.PanelUserState,error)
	PanelWhitelist(context.Context)([]string,error)
	PanelActionResult(context.Context,string)(string,error)
	SavePanelActionResult(context.Context,string,string,any)error
	PanelPersistence(context.Context)(bool,error)
	PanelPendingRestores(context.Context)(int64,error)
}
type panelControl struct {
	token string
	settings panelSettings
	store panelStore
	action telegram.ActionHandler
	summary func(context.Context)(any,error)
	lastCheck func()time.Time
	notify func(telegram.Action)
	mu sync.Mutex
}

// Both the Telegram buttons and panel pass through the same serialised handler.
// The original upstream handler owns restore queues and temporary ignores.
func newPanelActionHandler(original telegram.ActionHandler,c *cache.Cache,cfg *config.Provider) telegram.ActionHandler {
	var mu sync.Mutex
	return func(ctx context.Context,a telegram.Action)error {
		mu.Lock();defer mu.Unlock()
		if a.Name=="disable"||a.Name=="disable_temp" {
			release,ok:=panelbridge.BeginDisable();if !ok{return errors.New(i18n.T("error.panel.paused"))}
			defer release()
		}
		if a.Name=="disable_temp" {
			persistent,err:=c.PanelPersistence(ctx)
			if err!=nil{return err}
			if !persistent{return errors.New(i18n.T("error.panel.temporary_block_persistence"))}
		}
		if a.Name=="ignore_temp" {
			states,err:=c.PanelStates(ctx,[]int64{a.UserID});if err!=nil{return err}
			if states[strconv.FormatInt(a.UserID,10)].PermanentIgnore{return errors.New(i18n.T("error.panel.remove_permanent_ignore"))}
		}
		var err error
		if a.Name=="unignore" {err=c.RemoveFromWhitelist(ctx,a.UserID)} else {err=original(ctx,a)}
		source,_:=ctx.Value(panelSourceKey{}).(string);if source=="" {source="telegram"}
		requestID,_:=ctx.Value(panelRequestKey{}).(string)
		minutes:=a.Minutes
		if a.Name=="disable_temp"&&minutes==0 {minutes=cfg.Load().AutoDisableDuration}
		if a.Name=="ignore_temp"&&minutes==0 {minutes=cfg.Load().IgnoreDuration}
		message:="";if err!=nil {message=err.Error()}
		panelbridge.Emit(ctx,"action",&api.CachedUser{UserID:a.UserID},map[string]any{
			"action":a.Name,"minutes":minutes,"source":source,"requestId":requestID,"success":err==nil,"message":message,
		})
		return err
	}
}

func (p *panelControl) ServeHTTP(w http.ResponseWriter,r *http.Request) {
	w.Header().Set("Content-Type","application/json")
	w.Header().Set("Cache-Control","no-store")
	authorization:=r.Header.Get("Authorization")
	provided:=strings.TrimPrefix(authorization,"Bearer ")
	if !strings.HasPrefix(authorization,"Bearer ")||len(p.token)<32||len(provided)!=len(p.token)||subtle.ConstantTimeCompare([]byte(provided),[]byte(p.token))!=1 {
		p.fail(w,http.StatusUnauthorized,i18n.T("error.panel.invalid_credentials"));return
	}
	ctx,cancel:=context.WithTimeout(r.Context(),25*time.Second);defer cancel()
	r=r.WithContext(ctx)
	switch {
	case r.Method==http.MethodGet&&r.URL.Path=="/health":
		p.ok(w,map[string]any{"ready":!panelbridge.Paused(),"pauseReason":panelbridge.PauseReason(),"lastCheck":p.lastCheck()})
	case r.Method==http.MethodPost&&r.URL.Path=="/pause":
		if err:=panelbridge.Pause(ctx);err!=nil{p.fail(w,503,i18n.T("error.panel.pause_timeout"));return}
		pending,err:=p.store.PanelPendingRestores(ctx);if err!=nil{p.fail(w,503,i18n.T("error.panel.restore_queue_unavailable"));return}
		p.ok(w,map[string]any{"paused":true,"pendingRestores":pending})
	case r.Method==http.MethodPost&&r.URL.Path=="/resume":
		panelbridge.Resume();p.ok(w,map[string]any{"ready":true})
	case r.Method==http.MethodGet&&r.URL.Path=="/settings":p.ok(w,p.settings.Items())
	case r.Method==http.MethodPut&&r.URL.Path=="/settings":
		var values map[string]string
		if !p.decode(w,r,&values){return}
		if len(values)>40 {p.fail(w,400,i18n.T("error.panel.too_many_settings"));return}
		if values["ACTION_MODE"]=="auto" {
			persistent,err:=p.store.PanelPersistence(ctx)
			if err!=nil||!persistent {p.fail(w,400,i18n.T("error.panel.auto_mode_persistence"));return}
		}
		if err:=p.settings.ApplyMany(ctx,values);err!=nil {p.fail(w,400,err.Error());return}
		p.ok(w,p.settings.Items())
	case r.Method==http.MethodPost&&r.URL.Path=="/settings/reset":
		var body struct{Key string `json:"key"`}
		if !p.decode(w,r,&body){return}
		var err error
		if body.Key=="" {err=p.settings.ResetAll(ctx)} else {_,err=p.settings.Reset(ctx,body.Key)}
		if err!=nil{p.fail(w,400,err.Error());return};p.ok(w,p.settings.Items())
	case r.Method==http.MethodGet&&r.URL.Path=="/stats":
		data,err:=p.summary(ctx);if err!=nil {p.fail(w,503,i18n.T("error.panel.stats_unavailable"));return};p.ok(w,data)
	case r.Method==http.MethodGet&&r.URL.Path=="/state":
		ids,err:=panelIDs(r.URL.Query().Get("ids"));if err!=nil{p.fail(w,400,err.Error());return}
		data,err:=p.store.PanelStates(ctx,ids);if err!=nil{p.fail(w,503,i18n.T("error.panel.user_states_unavailable"));return};p.ok(w,data)
	case r.Method==http.MethodGet&&r.URL.Path=="/ignored":
		ids,err:=p.store.PanelWhitelist(ctx);if err!=nil{p.fail(w,503,i18n.T("error.panel.exclusions_unavailable"));return};p.ok(w,ids)
	case r.Method==http.MethodPost&&r.URL.Path=="/actions":p.perform(w,r)
	default:p.fail(w,404,i18n.T("error.panel.command_not_found"))
	}
}

var panelRequestID=regexp.MustCompile(`^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$`)
func (p *panelControl) perform(w http.ResponseWriter,r *http.Request) {
	var body struct { UserID int64 `json:"userId"`;Action string `json:"action"`;Minutes int `json:"minutes"`;RequestID string `json:"requestId"` }
	if !p.decode(w,r,&body){return}
	allowed:=map[string]bool{"drop":true,"disable":true,"disable_temp":true,"enable":true,"ignore":true,"ignore_temp":true,"unignore":true}
	if body.UserID<=0||body.UserID>9007199254740991||!allowed[body.Action]||!panelRequestID.MatchString(body.RequestID) {
		p.fail(w,400,i18n.T("error.panel.invalid_action_or_user"));return
	}
	if (body.Action=="disable_temp"||body.Action=="ignore_temp")&&(body.Minutes<1||body.Minutes>525600) {p.fail(w,400,i18n.T("error.panel.invalid_duration"));return}
	if body.Action!="disable_temp"&&body.Action!="ignore_temp"&&body.Minutes!=0 {p.fail(w,400,i18n.T("error.panel.unexpected_duration"));return}
	raw,_:=json.Marshal(body);digest:=sha256.Sum256(raw);fingerprint:=hex.EncodeToString(digest[:])
	p.mu.Lock();defer p.mu.Unlock()
	prior,err:=p.store.PanelActionResult(r.Context(),body.RequestID)
	if err!=nil{p.fail(w,503,i18n.T("error.panel.action_retry_check_failed"));return}
	if prior!="" {
		var saved struct {Fingerprint string `json:"fingerprint"`;Result any `json:"result"`}
		if json.Unmarshal([]byte(prior),&saved)!=nil||saved.Fingerprint!=fingerprint{p.fail(w,409,i18n.T("error.panel.request_id_conflict"));return}
		p.ok(w,saved.Result);return
	}
	ctx:=context.WithValue(r.Context(),panelSourceKey{},"panel")
	ctx=context.WithValue(ctx,panelRequestKey{},body.RequestID)
	if err:=p.action(ctx,telegram.Action{Name:body.Action,UserID:body.UserID,Minutes:body.Minutes});err!=nil {p.fail(w,502,err.Error());return}
	state,err:=p.store.PanelStates(ctx,[]int64{body.UserID})
	result:=map[string]any{"success":true,"action":body.Action,"userId":body.UserID,"state":state[strconv.FormatInt(body.UserID,10)]}
	if err!=nil {result["warning"]=i18n.T("panel.warning.refresh_state")}
	if err:=p.store.SavePanelActionResult(ctx,body.RequestID,fingerprint,result);err!=nil {result["warning"]=i18n.T("panel.warning.do_not_repeat")}
	if p.notify!=nil {p.notify(telegram.Action{Name:body.Action,UserID:body.UserID,Minutes:body.Minutes})}
	p.ok(w,result)
}
func panelIDs(raw string)([]int64,error) {
	if raw=="" {return []int64{},nil}
	parts:=strings.Split(raw,",");if len(parts)>250{return nil,errors.New(i18n.T("error.panel.too_many_users"))}
	ids:=make([]int64,0,len(parts));seen:=map[int64]bool{}
	for _,part:=range parts {id,err:=strconv.ParseInt(part,10,64);if err!=nil||id<1||id>9007199254740991{return nil,errors.New(i18n.T("error.panel.invalid_user"))};if !seen[id]{ids=append(ids,id);seen[id]=true}}
	return ids,nil
}
func (p *panelControl) decode(w http.ResponseWriter,r *http.Request,target any)bool {
	r.Body=http.MaxBytesReader(w,r.Body,65536)
	d:=json.NewDecoder(r.Body);d.DisallowUnknownFields()
	if err:=d.Decode(target);err!=nil{p.fail(w,400,i18n.T("error.panel.invalid_request"));return false}
	var trailing any
	if err:=d.Decode(&trailing);err!=io.EOF {p.fail(w,400,i18n.T("error.panel.invalid_request"));return false}
	return true
}
func (p *panelControl) ok(w http.ResponseWriter,v any){_ = json.NewEncoder(w).Encode(map[string]any{"response":v})}
func (p *panelControl) fail(w http.ResponseWriter,status int,message string){w.WriteHeader(status);_ = json.NewEncoder(w).Encode(map[string]any{"message":message})}

func startPanelControl(ctx context.Context,c *cache.Cache,cfg *config.Provider,mgr *settings.Manager,mon *monitor.Monitor,trafficMon *traffic.Monitor,action telegram.ActionHandler,bot *telegram.Bot,logger *logrus.Logger)error {
	path:=os.Getenv("REMNADROP_PANEL_CONTROL_SOCKET");if path==""{return nil}
	token:=os.Getenv("REMNADROP_PANEL_CONTROL_TOKEN");if len(token)<32{return errors.New(i18n.T("error.panel.control_credential_missing"))}
	if existing,err:=os.Lstat(path);err==nil {
		if existing.Mode()&os.ModeSocket==0 {return errors.New(i18n.T("error.panel.control_path_not_socket"))}
		if err:=os.Remove(path);err!=nil{return err}
	}else if !errors.Is(err,os.ErrNotExist){return err}
	listener,err:=net.Listen("unix",path);if err!=nil{return err}
	if err:=os.Chmod(path,0600);err!=nil{listener.Close();return err}
	handler:=&panelControl{token:token,settings:mgr,store:c,action:action,lastCheck:mon.LastSuccessfulCheck,
		notify:func(a telegram.Action){
			if !bot.NotificationsEnabled(){return}
			go func(){
				notifyCtx,cancel:=context.WithTimeout(context.Background(),8*time.Second);defer cancel()
				if err:=bot.SendPanelActivity(notifyCtx,a);err!=nil {logger.Warn(i18n.T("log.panel_activity_notice_failed"))}
			}()
		},
		summary:func(ctx context.Context)(any,error){
			stats,err:=c.GetViolationStats(ctx,10);if err!=nil{return nil,err}
			heavy,heavyErr:=trafficMon.HeavyReport(ctx)
			data:=map[string]any{"violations":stats,"heavyTraffic":heavy,"lastCheck":mon.LastSuccessfulCheck()}
			if heavyErr!=nil{data["heavyTrafficError"]=i18n.T("panel.warning.traffic_unavailable")}
			return data,nil
		},
	}
	server:=&http.Server{Handler:handler,ReadHeaderTimeout:3*time.Second,ReadTimeout:10*time.Second,WriteTimeout:30*time.Second,IdleTimeout:30*time.Second,MaxHeaderBytes:8192}
	go func(){if err:=server.Serve(listener);err!=nil&&err!=http.ErrServerClosed{logger.WithError(err).Error(i18n.T("log.panel_control_stopped"))}}()
	go func(){<-ctx.Done();shutdown,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel();_ = server.Shutdown(shutdown);_ = os.Remove(path)}()
	return nil
}
