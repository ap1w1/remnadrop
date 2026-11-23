import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { GetJWTPayload } from '@common/decorators/get-jwt-payload/get-jwt-payload';
import { Roles } from '@common/decorators/roles/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';

import { PanelEventsService } from './panel-events.service';
import { PanelPushService } from './panel-push.service';
import { SslCertificatesService } from './ssl-certificates.service';

@Controller('panel-events')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class PanelEventsController {
    constructor(
        private readonly events: PanelEventsService,
        private readonly push: PanelPushService,
    ) {}
    @Get() list(
        @GetJWTPayload() user: { uuid: string },
        @Query() query: {
            before?: string;
            after?: string;
            type?: string;
            severity?: string;
            limit?: string;
        },
    ) {
        return this.events.list(user.uuid, query);
    }
    @Post('read') read(@GetJWTPayload() user: { uuid: string }, @Body() body: unknown) {
        return this.events.read(user.uuid, body);
    }
    @Get('preferences') preferences(@GetJWTPayload() user: { uuid: string }) {
        return this.events.preferences(user.uuid);
    }
    @Put('preferences') save(@GetJWTPayload() user: { uuid: string }, @Body() body: unknown) {
        return this.events.savePreferences(user.uuid, body);
    }
    @Get('push/config') config() {
        return { response: this.push.config() };
    }
    @Post('push/subscription') subscribe(
        @GetJWTPayload() user: { uuid: string },
        @Body() body: unknown,
    ) {
        return this.push.subscribe(user.uuid, body);
    }
    @Post('push/unsubscribe') unsubscribe(
        @GetJWTPayload() user: { uuid: string },
        @Body() body: unknown,
    ) {
        return this.push.unsubscribe(user.uuid, body);
    }
}

@Controller('ssl-certificates')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class SslCertificatesController {
    constructor(private readonly certificates: SslCertificatesService) {}
    @Get() list() {
        return this.certificates.list();
    }
    @Post() create(@Body() body: unknown) {
        return this.certificates.save(undefined, body);
    }
    @Put(':id') update(@Param('id') id: string, @Body() body: unknown) {
        return this.certificates.save(id, body);
    }
    @Delete(':id') remove(@Param('id') id: string) {
        return this.certificates.remove(id);
    }
}
