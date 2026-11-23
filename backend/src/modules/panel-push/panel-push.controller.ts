import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { GetJWTPayload } from '@common/decorators/get-jwt-payload';
import { Roles } from '@common/decorators/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ROLE } from '@libs/contracts/constants';
import { IJWTAuthPayload } from '@modules/auth/interfaces';
import { panelAdminUuid } from '../panel-events/panel-events.controller';
import { PanelPushService } from './panel-push.service';

@Controller('panel-events/push')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class PanelPushController {
    constructor(private readonly push: PanelPushService) {}

    @Get('config')
    config(@GetJWTPayload() payload: IJWTAuthPayload, @Headers('referer') referer?: string) {
        panelAdminUuid(payload);
        return this.push.config(referer);
    }

    @Post('subscriptions')
    subscribe(@GetJWTPayload() payload: IJWTAuthPayload, @Body() body: unknown, @Headers('referer') referer?: string) {
        return this.push.subscribe(panelAdminUuid(payload), body, referer);
    }

    @Delete('subscriptions')
    unsubscribe(@GetJWTPayload() payload: IJWTAuthPayload, @Body() body: unknown) {
        return this.push.unsubscribe(panelAdminUuid(payload), body);
    }
}
