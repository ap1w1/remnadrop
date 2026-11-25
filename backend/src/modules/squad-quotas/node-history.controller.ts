import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { ROLE } from '@libs/contracts/constants';
import { NodeHistoryService } from './node-history.service';

@Controller('nodes/metrics/history')
@Roles(ROLE.ADMIN, ROLE.API)
@ApiScopeResource('nodes')
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
export class NodeHistoryController {
    constructor(private readonly historyService: NodeHistoryService) {}
    @Get()
    async history(@Query('nodes') nodes: string, @Query('from') from: string, @Query('to') to: string) {
        return { response: await this.historyService.history(nodes, from, to) };
    }
}
