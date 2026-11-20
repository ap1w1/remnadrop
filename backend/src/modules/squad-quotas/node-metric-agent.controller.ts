import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UnauthorizedException, UseGuards, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '@common/database/prisma.service';
import { Roles } from '@common/decorators/roles/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';

@Controller('nodes/:uuid/metrics-agent')
export class NodeMetricAgentController {
    constructor(private readonly db: PrismaService) {}
    private token(uuid: string) {
        const secret=process.env.NODE_METRICS_SECRET;
        if (!secret || secret.length<32) throw new ServiceUnavailableException('Set NODE_METRICS_SECRET (at least 32 characters)');
        return createHmac('sha256',secret).update(`node-metrics:${uuid}`).digest('hex');
    }
    @Get('token')
    @Roles(ROLE.ADMIN)
    @UseGuards(JwtDefaultGuard, RolesGuard)
    async issue(@Param('uuid', ParseUUIDPipe) uuid: string) {
        if (!await this.db.nodes.findUnique({where:{uuid}})) throw new NotFoundException();
        return {response:{token:this.token(uuid)}};
    }
    @Post()
    async ingest(@Param('uuid', ParseUUIDPipe) uuid: string, @Headers('authorization') authorization: string, @Body() body: {cpu: number}) {
        const expected=Buffer.from(`Bearer ${this.token(uuid)}`);
        const supplied=Buffer.from(authorization || '');
        if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new UnauthorizedException();
        if (typeof body?.cpu!=='number' || !Number.isFinite(body.cpu) || body.cpu<0 || body.cpu>100) throw new BadRequestException('cpu must be within 0..100');
        if (!await this.db.nodes.findUnique({where:{uuid}})) throw new NotFoundException();
        await this.db.$executeRaw`INSERT INTO node_metric_agent_snapshots(node_uuid,cpu) VALUES (${uuid}::uuid,${body.cpu}) ON CONFLICT(node_uuid) DO UPDATE SET received_at=now(),cpu=excluded.cpu`;
        return {response:{success:true}};
    }
}
