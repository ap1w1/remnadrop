import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { LimiterService } from './limiter.service';

@Controller('limiter')
@Roles(ROLE.ADMIN)
@ApiScopeResource('users')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class LimiterController {
 constructor(private readonly limiter:LimiterService){}
 @Get('settings') settings(){return this.limiter.settings();}
 @Put('settings') update(@Body() input:unknown){return this.limiter.update(input);}
 @Get('events') events(){return this.limiter.events();}
 @Post('ignore/:uuid') ignore(@Param('uuid',ParseUUIDPipe) uuid:string){return this.limiter.ignore(uuid);}
 @Post('unignore/:uuid') unignore(@Param('uuid',ParseUUIDPipe) uuid:string){return this.limiter.unignore(uuid);}
}
