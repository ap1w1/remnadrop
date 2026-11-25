import { Controller, Get, UseGuards } from '@nestjs/common';
import { statfsSync } from 'node:fs';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';

@Controller('remnadrop/disk-metrics')
@Roles(ROLE.ADMIN,ROLE.API)
@ApiScopeResource('system')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class DiskMetricsController {
 @Get()
 getDisks(){
   // / reports overlayfs backing space in the container. Add host disk
   // mountpoints read-only to the container and set REMNADROP_DISK_PATHS
   // to expose separate filesystems. No sudo or host shell execution.
   const paths=[...new Set((process.env.REMNADROP_DISK_PATHS??'/')
     .split(',').map(v=>v.trim()).filter(v=>v.startsWith('/')&&!v.includes('..')).slice(0,8))];
   const disks=paths.map(path=>{
     try {
       const stat=statfsSync(path,{bigint:true});
       const total=stat.blocks*stat.bsize;
       const available=stat.bavail*stat.bsize;
       const free=stat.bfree*stat.bsize;
       const used=total-free;
       return {path,totalBytes:total.toString(),availableBytes:available.toString(),
         usedBytes:used.toString(),percentUsed:total===0n?0:Math.round(Number(used*10000n/total)/100)};
     }catch{return {path,error:'Filesystem unavailable in panel container'};}
   });
   return {response:{disks,scannedAt:new Date().toISOString()}};
 }
}
