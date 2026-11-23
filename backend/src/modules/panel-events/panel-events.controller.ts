import { Body, Controller, Get, Post, Put, Query, UnauthorizedException, UseGuards } from '@nestjs/common';

import { GetJWTPayload } from '@common/decorators/get-jwt-payload';
import { Roles } from '@common/decorators/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ROLE } from '@libs/contracts/constants';
import { IJWTAuthPayload } from '@modules/auth/interfaces';

import { UUID_PATTERN } from './panel-events.constants';
import { PanelEventsService } from './panel-events.service';

export function panelAdminUuid(payload: IJWTAuthPayload): string {
    if (typeof payload?.uuid !== 'string' || !UUID_PATTERN.test(payload.uuid)) {
        throw new UnauthorizedException('Требуется сеанс администратора');
    }
    return payload.uuid;
}

@Controller('panel-events')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class PanelEventsController {
    constructor(private readonly events: PanelEventsService) {}

    @Get()
    list(@GetJWTPayload() payload: IJWTAuthPayload, @Query() query: Record<string, unknown>) {
        return this.events.list(panelAdminUuid(payload), query);
    }

    @Get('summary')
    summary(@GetJWTPayload() payload: IJWTAuthPayload) {
        return this.events.summary(panelAdminUuid(payload));
    }

    @Post('read')
    read(@GetJWTPayload() payload: IJWTAuthPayload, @Body() body: unknown) {
        return this.events.markRead(panelAdminUuid(payload), body);
    }

    @Get('preferences')
    preferences(@GetJWTPayload() payload: IJWTAuthPayload) {
        return this.events.preferences(panelAdminUuid(payload));
    }

    @Put('preferences')
    setPreferences(@GetJWTPayload() payload: IJWTAuthPayload, @Body() body: unknown) {
        return this.events.setPreferences(panelAdminUuid(payload), body);
    }
}
