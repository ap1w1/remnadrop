import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { GetJWTPayload } from '@common/decorators/get-jwt-payload/get-jwt-payload';
import { Roles } from '@common/decorators/roles/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';

import { PanelEventsService } from './panel-events.service';
import { SslCertificatesService } from './ssl-certificates.service';
import { PanelUpdatesService } from './panel-updates.service';

@Controller('panel-events')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class PanelEventsController {
    constructor(
        private readonly events: PanelEventsService,
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

@Controller('panel-updates')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class PanelUpdatesController {
    constructor(private readonly updates:PanelUpdatesService) {}
    @Get() status(){return this.updates.status();}
    @Post() request(){return this.updates.request();}
}
