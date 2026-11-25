import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { DpiCheckerService, DpiLocation } from './dpi-checker.service';
import { DpiCredentialsService } from './dpi-credentials.service';
import { Put } from '@nestjs/common';

@Controller('dpi-checker')
@Roles(ROLE.ADMIN,ROLE.API)
@ApiScopeResource('nodes')
@UseGuards(JwtDefaultGuard,RolesGuard,ScopesGuard)
export class DpiCheckerController {
 constructor(private readonly dpi:DpiCheckerService,private readonly credentials:DpiCredentialsService){}
 @Get('settings') settings(){return this.credentials.status().then(response=>({response}));}
 @Put('settings') @Roles(ROLE.ADMIN) setKey(@Body() body:{apiKey:string}){return this.credentials.setKey(body.apiKey,key=>this.dpi.apiWithKey('/profile',key));}
 @Put('settings/proxy') @Roles(ROLE.ADMIN) setProxy(@Body() body:{proxyUrl:string|null}){return this.credentials.setProxy(body?.proxyUrl);}
 @Delete('settings') @Roles(ROLE.ADMIN) clearKey(){return this.credentials.clear();}
 @Get('profile') profile(){return this.dpi.profile();}
 @Get('billing-settings') @Roles(ROLE.ADMIN) billingSettings(){return this.dpi.billingSettings();}
 @Put('billing-settings') @Roles(ROLE.ADMIN) setBillingSettings(@Body() body:{enabled:boolean}){return this.dpi.setBillingSettings(body);}
 @Get('host-options') @Roles(ROLE.ADMIN) hostOptions(){return this.dpi.hostOptions();}
 @Get('pops') pops(@Query('location') location:DpiLocation,@Query('optimal') optimal?:string){return this.dpi.pops(location,optimal==='true').then(response=>({response}));}
 @Get('checks') list(){return this.dpi.list();}
 @Get('checks/:id') one(@Param('id',ParseUUIDPipe) id:string){return this.dpi.one(id);}
 @Post('checks/prepare') prepare(@Body() body:{hosts:string[];location:DpiLocation;pop_ids?:number[]}){return this.dpi.prepare(body);}
 @Post('checks/:id/start') start(@Param('id',ParseUUIDPipe) id:string){return this.dpi.start(id);}
 @Delete('checks/:id') cancel(@Param('id',ParseUUIDPipe) id:string){return this.dpi.cancel(id);}
}
