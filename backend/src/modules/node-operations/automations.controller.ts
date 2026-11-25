import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
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
    constructor(private readonly automations: AutomationsService) {}
    @Get() list() { return this.automations.list(); }
    @Get('options') options() { return this.automations.options(); }
    @Get('executions') executions(@Query() query: Parameters<AutomationsService['executions']>[0]) { return this.automations.executions(query); }
    // Node-scoped tokens must not gain a Cloudflare write bypass through automation.
    @Post() @Roles(ROLE.ADMIN)
    create(@Body() body: Parameters<AutomationsService['create']>[0]) { return this.automations.create(body); }
    @Post('preview') @Roles(ROLE.ADMIN)
    preview(@Body() body: Parameters<AutomationsService['preview']>[0]) { return this.automations.preview(body); }
    @Post(':id/preview') @Roles(ROLE.ADMIN)
    previewSaved(@Param('id',ParseUUIDPipe) id: string) { return this.automations.previewSaved(id); }
    @Post(':id/run') @Roles(ROLE.ADMIN)
    run(@Param('id',ParseUUIDPipe) id: string, @Body() body: Parameters<AutomationsService['runNow']>[1]) { return this.automations.runNow(id,body); }
    @Post(':id/duplicate') @Roles(ROLE.ADMIN)
    duplicate(@Param('id',ParseUUIDPipe) id: string) { return this.automations.duplicate(id); }
    @Put(':id/enabled') @Roles(ROLE.ADMIN)
    enabled(@Param('id',ParseUUIDPipe) id: string, @Body() body: {enabled:boolean}) { return this.automations.setEnabled(id,body?.enabled); }
    @Put(':id') @Roles(ROLE.ADMIN)
    update(@Param('id',ParseUUIDPipe) id: string, @Body() body: Parameters<AutomationsService['update']>[1]) { return this.automations.update(id,body); }
    @Delete(':id') @Roles(ROLE.ADMIN)
    delete(@Param('id',ParseUUIDPipe) id: string) { return this.automations.remove(id); }
}
