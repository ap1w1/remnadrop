import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { SquadQuotasService } from './squad-quotas.service';

@Controller('users/:userUuid/node-quotas')
@Roles(ROLE.ADMIN, ROLE.API)
@ApiScopeResource('users')
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
export class SquadQuotasController {
    constructor(private readonly quotas: SquadQuotasService) {}
    @Get()
    async list(@Param('userUuid', ParseUUIDPipe) userUuid: string) {
        return { response: await this.quotas.list(userUuid), legacyNeedsReview: await this.quotas.legacyNeedsReview(userUuid) };
    }
    @Get('groups')
    async listGroups(@Param('userUuid', ParseUUIDPipe) userUuid:string) {
        return {response:await this.quotas.listGroups(userUuid)};
    }
    @Post('groups')
    async createGroup(@Param('userUuid', ParseUUIDPipe) userUuid:string,@Body() body:{name:string;nodeUuids:string[];limitBytes:string}) {
        return {response:await this.quotas.configureGroup(userUuid,null,body?.name,body?.nodeUuids,body?.limitBytes)};
    }
    @Put('groups/:groupUuid')
    async updateGroup(@Param('userUuid', ParseUUIDPipe) userUuid:string,@Param('groupUuid', ParseUUIDPipe) groupUuid:string,@Body() body:{name:string;nodeUuids:string[];limitBytes:string}) {
        return {response:await this.quotas.configureGroup(userUuid,groupUuid,body?.name,body?.nodeUuids,body?.limitBytes)};
    }
    @Delete('groups/:groupUuid')
    async removeGroup(@Param('userUuid', ParseUUIDPipe) userUuid:string,@Param('groupUuid', ParseUUIDPipe) groupUuid:string) {
        return {response:await this.quotas.removeGroup(userUuid,groupUuid)};
    }
    @Post('groups/:groupUuid/reset')
    async resetGroup(@Param('userUuid', ParseUUIDPipe) userUuid:string,@Param('groupUuid', ParseUUIDPipe) groupUuid:string) {
        return {response:await this.quotas.resetGroup(userUuid,groupUuid)};
    }
    /** Common settings for every node in this user's subscription. */
    @Get('settings')
    async getSettings(@Param('userUuid', ParseUUIDPipe) userUuid: string) {
        return {response:await this.quotas.getPolicy(userUuid)};
    }
    @Put('settings')
    async setSettings(
        @Param('userUuid', ParseUUIDPipe) userUuid:string,
        @Body() body:{periodDays:number|null;thresholdPercent:number},
    ) {
        return {response:await this.quotas.setPolicy(userUuid,body.periodDays,body.thresholdPercent)};
    }
    @Get('status')
    async status(@Param('userUuid', ParseUUIDPipe) userUuid:string) {
        return {response:await this.quotas.status(userUuid)};
    }
    @Post('reset-all')
    async resetAll(@Param('userUuid', ParseUUIDPipe) userUuid:string) {
        return {response:await this.quotas.resetAll(userUuid)};
    }
    @Put(':nodeUuid')
    async configure(@Param('userUuid', ParseUUIDPipe) userUuid: string, @Param('nodeUuid', ParseUUIDPipe) nodeUuid: string, @Body() body: { limitBytes: string | null; periodDays?: number | null; thresholdPercent?: number }) {
        return { response: await this.quotas.configure(userUuid, nodeUuid, body.limitBytes, body.periodDays ?? null, body.thresholdPercent ?? 80) };
    }
    @Delete(':nodeUuid')
    async remove(@Param('userUuid', ParseUUIDPipe) userUuid:string,@Param('nodeUuid', ParseUUIDPipe) nodeUuid:string) {
        return {response:await this.quotas.remove(userUuid,nodeUuid)};
    }
    @Post(':nodeUuid/reset')
    async reset(@Param('userUuid', ParseUUIDPipe) userUuid: string, @Param('nodeUuid', ParseUUIDPipe) nodeUuid: string) {
        return { response: await this.quotas.reset(userUuid, nodeUuid) };
    }
}

@Controller('node-quotas/global-settings')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class GlobalNodeQuotasController {
    constructor(private readonly quotas: SquadQuotasService) {}
    @Get() get() { return this.quotas.getGlobalPolicy().then(response=>({response})); }
    @Put() set(@Body() body:{periodDays:number|null;thresholdPercent?:number;thresholdPercents?:number[]}) {
        return this.quotas.setGlobalPolicy(body.periodDays,body.thresholdPercents??body.thresholdPercent).then(response=>({response}));
    }
}
