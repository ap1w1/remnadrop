import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { LimiterService } from './limiter.service';
import { LimiterRunnerService } from './limiter-runner.service';
import { LimiterCredentialsService } from './limiter-credentials.service';

@Controller('limiter')
@Roles(ROLE.ADMIN)
@ApiScopeResource('users')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class LimiterController {
 constructor(private readonly limiter:LimiterService,private readonly credentials:LimiterCredentialsService,private readonly runner:LimiterRunnerService){}
 @Get('settings') settings(){return this.limiter.settings();}
 @Get('status') status(){return this.runner.status();}
 @Put('settings') update(@Body() input:unknown){return this.limiter.update(input);}
 @Get('settings/runtime') runtimeSettings(){return this.limiter.runtimeSettings();}
 @Post('settings/reset') resetSettings(@Body() body:unknown){return this.limiter.resetSettings(body);}
 @Get('events') events(){return this.limiter.events();}
 @Get('summary') summary(){return this.limiter.summary();}
 @Get('actions') actions(){return this.limiter.actions();}
 @Get('ignored') ignored(){return this.limiter.ignored();}
 @Post('users/:uuid/actions') action(@Param('uuid',ParseUUIDPipe) uuid:string,@Body() body:unknown){return this.limiter.action(uuid,body);}
 @Get('credentials') credentialsStatus(){return this.credentials.status();}
 @Put('credentials') configureCredentials(@Body() body:unknown){return this.credentials.save(body);}
 @Delete('credentials') clearCredentials(){return this.credentials.remove();}
 @Post('ignore/:uuid') ignore(@Param('uuid',ParseUUIDPipe) uuid:string){return this.limiter.ignore(uuid);}
 @Post('unignore/:uuid') unignore(@Param('uuid',ParseUUIDPipe) uuid:string){return this.limiter.unignore(uuid);}
}
