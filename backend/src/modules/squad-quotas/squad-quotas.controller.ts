import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
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
    @Post(':nodeUuid/reset')
    async reset(@Param('userUuid', ParseUUIDPipe) userUuid: string, @Param('nodeUuid', ParseUUIDPipe) nodeUuid: string) {
        return { response: await this.quotas.reset(userUuid, nodeUuid) };
    }
}
