import { randomUUID } from 'node:crypto';
import { access, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';

const directory='/app/panel-updates';
const source='https://api.github.com/repos/ap1w1/remnadrop/commits/main';
type UpdateState={state:'queued'|'running'|'success'|'failed';requestedAt?:string;finishedAt?:string;message?:string};

@Injectable()
export class PanelUpdatesService {
    private remote:{sha:string|null;checkedAt:number;error:string|null}|null=null;

    private async latest() {
        if(this.remote&&Date.now()-this.remote.checkedAt<300000)return this.remote;
        try {
            const response=await fetch(source,{headers:{'Accept':'application/vnd.github+json','User-Agent':'RemnaDrop'},signal:AbortSignal.timeout(6000)});
            if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`);
            const data=await response.json() as {sha?:string};
            if(!data.sha||!/^[a-f0-9]{40}$/i.test(data.sha))throw new Error('GitHub returned no commit SHA');
            this.remote={sha:data.sha,checkedAt:Date.now(),error:null};
        }catch(error){this.remote={sha:null,checkedAt:Date.now(),error:error instanceof Error?error.message:'GitHub unavailable'};}
        return this.remote;
    }

    async status() {
        let available=true;
        try { await access(join(directory,'agent-ready')); } catch { available=false; }
        let update:UpdateState|null=null;
        if(available)try { update=JSON.parse(await readFile(join(directory,'status.json'),'utf8')) as UpdateState; } catch { /* First run. */ }
        const remote=await this.latest();
        const installedSha=process.env.REMNADROP_GIT_SHA||null;
        return {response:{available,installedSha,latestSha:remote.sha,checkError:remote.error,
            updateAvailable:!!remote.sha&&!!installedSha&&remote.sha!==installedSha,update}};
    }

    async request() {
        try { await access(join(directory,'agent-ready')); } catch { throw new ServiceUnavailableException('Host update agent is not installed'); }
        for(const name of ['request.json','processing.json'])try {
            await access(join(directory,name));
            throw new ConflictException('An update is already queued or running');
        }catch(error){if(error instanceof ConflictException)throw error;}
        const request={id:randomUUID(),requestedAt:new Date().toISOString()};
        try {
            const file=await open(join(directory,'request.json'),'wx',0o600);
            try { await file.writeFile(JSON.stringify(request)); } finally { await file.close(); }
        }catch(error){
            if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ConflictException('An update is already queued');
            throw new ServiceUnavailableException('Cannot queue a host update');
        }
        return {response:{queued:true,id:request.id}};
    }
}
