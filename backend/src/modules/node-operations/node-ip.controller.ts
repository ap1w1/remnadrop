import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { NodeIpService } from './node-ip.service';

@Controller('nodes/:uuid/ip-pool')
@Roles(ROLE.ADMIN,ROLE.API)
@ApiScopeResource('nodes')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class NodeIpController {
 constructor(private readonly ips:NodeIpService){}
 @Get() list(@Param('uuid',ParseUUIDPipe) uuid:string){return this.ips.list(uuid);}
 @Post() add(@Param('uuid',ParseUUIDPipe) uuid:string,@Body() body:{ip:string;rotationMinutes?:number|null}){return this.ips.add(uuid,body.ip,body.rotationMinutes);}
 @Post('probe') probe(@Param('uuid',ParseUUIDPipe) uuid:string,@Body() body:{ip:string}){return this.ips.probe(uuid,body.ip);}
 @Post(':id/rotate') rotate(@Param('uuid',ParseUUIDPipe) uuid:string,@Param('id',ParseUUIDPipe) id:string){return this.ips.rotate(uuid,id);}
 @Delete(':id') remove(@Param('uuid',ParseUUIDPipe) uuid:string,@Param('id',ParseUUIDPipe) id:string){return this.ips.remove(uuid,id);}
}
