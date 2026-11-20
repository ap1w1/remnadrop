import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { AutomationsService } from './automations.service';

@Controller('node-automations')
@Roles(ROLE.ADMIN,ROLE.API)
@ApiScopeResource('nodes')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class AutomationsController {
  constructor(private readonly automations:AutomationsService){}
  @Get() list(){return this.automations.list();}
  @Get('executions') executions(){return this.automations.executions();}
  @Post() create(@Body() body:Parameters<AutomationsService['create']>[0]){return this.automations.create(body);}
  @Put(':id') update(@Param('id',ParseUUIDPipe) id:string,@Body() body:Parameters<AutomationsService['update']>[1]){return this.automations.update(id,body);}
  @Delete(':id') delete(@Param('id',ParseUUIDPipe) id:string){return this.automations.remove(id);}
}
