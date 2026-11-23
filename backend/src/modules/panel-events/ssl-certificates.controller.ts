import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';

import { GetJWTPayload } from '@common/decorators/get-jwt-payload';
import { Roles } from '@common/decorators/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ROLE } from '@libs/contracts/constants';
import { IJWTAuthPayload } from '@modules/auth/interfaces';

import { panelAdminUuid } from './panel-events.controller';
import { SslCertificatesService } from './ssl-certificates.service';

@Controller('ssl-certificates')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class SslCertificatesController {
    constructor(private readonly certificates: SslCertificatesService) {}

    @Get()
    list() { return this.certificates.list(); }

    @Post()
    create(@GetJWTPayload() payload: IJWTAuthPayload, @Body() body: unknown) {
        return this.certificates.save(panelAdminUuid(payload), body);
    }

    @Put(':id')
    update(@GetJWTPayload() payload: IJWTAuthPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
        return this.certificates.save(panelAdminUuid(payload), body, id);
    }

    @Delete(':id')
    remove(@Param('id', ParseUUIDPipe) id: string) { return this.certificates.remove(id); }
}
