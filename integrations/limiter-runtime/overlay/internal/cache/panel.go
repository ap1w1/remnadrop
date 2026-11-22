package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type PanelUserState struct {
	Ignored bool `json:"ignored"`
	PermanentIgnore bool `json:"permanentIgnore"`
	IgnoredUntil *time.Time `json:"ignoredUntil"`
	RestoreAt *time.Time `json:"restoreAt"`
}

func (c *Cache) RemoveFromWhitelist(ctx context.Context,userID int64) error {
	id:=formatUserID(userID)
	pipe:=c.client.TxPipeline()
	pipe.SRem(ctx,keyWhitelist,id)
	pipe.Del(ctx,prefixWhitelistTemp+id)
	_,err:=pipe.Exec(ctx)
	return err
}

func (c *Cache) PanelStates(ctx context.Context,ids []int64)(map[string]PanelUserState,error) {
	result:=make(map[string]PanelUserState,len(ids))
	pipe:=c.client.Pipeline()
	type commands struct { perm *redis.BoolCmd; temp *redis.DurationCmd; restore *redis.FloatCmd }
	list:=make([]commands,len(ids))
	for i,id:=range ids {
		s:=formatUserID(id)
		list[i]=commands{pipe.SIsMember(ctx,keyWhitelist,s),pipe.TTL(ctx,prefixWhitelistTemp+s),pipe.ZScore(ctx,keyRestoreQ,s)}
	}
	if _,err:=pipe.Exec(ctx);err!=nil&&err!=redis.Nil{return nil,err}
	for i,id:=range ids {
		v:=list[i]; st:=PanelUserState{Ignored:v.perm.Val()||v.temp.Val()>0,PermanentIgnore:v.perm.Val()}
		if ttl:=v.temp.Val();ttl>0 { t:=time.Now().Add(ttl);st.IgnoredUntil=&t }
		if score,err:=v.restore.Result();err==nil { t:=time.Unix(int64(score),0);st.RestoreAt=&t }
		result[formatUserID(id)]=st
	}
	return result,nil
}

func (c *Cache) PanelWhitelist(ctx context.Context)([]string,error) {
	ids,err:=c.client.SMembers(ctx,keyWhitelist).Result()
	if err!=nil{return nil,err}
	seen:=map[string]bool{}
	for _,id:=range ids { seen[id]=true }
	var cursor uint64
	for {
		keys,next,err:=c.client.Scan(ctx,cursor,prefixWhitelistTemp+"*",200).Result()
		if err!=nil{return nil,err}
		for _,key:=range keys { id:=key[len(prefixWhitelistTemp):];if _,err:=strconv.ParseInt(id,10,64);err==nil&&!seen[id] {ids=append(ids,id);seen[id]=true} }
		cursor=next
		if cursor==0||len(ids)>=1000 {break}
	}
	return ids,nil
}

func (c *Cache) ReplaceConfigOverrides(ctx context.Context,values map[string]string)error {
	pipe:=c.client.TxPipeline()
	pipe.Del(ctx,keyConfigOverrides)
	if len(values)>0 {
		fields:=make(map[string]any,len(values))
		for k,v:=range values {fields[k]=v}
		pipe.HSet(ctx,keyConfigOverrides,fields)
	}
	_,err:=pipe.Exec(ctx);return err
}

// Completed requests survive restarts and prevent repeat clicks extending timers.
func (c *Cache) PanelActionResult(ctx context.Context,id string)(string,error) {
	s,err:=c.client.Get(ctx,"panel:action:"+id).Result()
	if err==redis.Nil{return "",nil};return s,err
}
func (c *Cache) SavePanelActionResult(ctx context.Context,id,fingerprint string,result any)error {
	raw,err:=json.Marshal(map[string]any{"fingerprint":fingerprint,"result":result})
	if err!=nil{return fmt.Errorf("encode action result: %w",err)}
	return c.client.Set(ctx,"panel:action:"+id,raw,24*time.Hour).Err()
}

func (c *Cache) PanelPersistence(ctx context.Context) (bool,error) {
	aof,err:=c.client.ConfigGet(ctx,"appendonly").Result();if err!=nil{return false,err}
	rdb,err:=c.client.ConfigGet(ctx,"save").Result();if err!=nil{return false,err}
	return aof["appendonly"]=="yes"||rdb["save"]!="",nil
}
func (c *Cache) PanelPendingRestores(ctx context.Context)(int64,error){return c.client.ZCard(ctx,keyRestoreQ).Result()}
