import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { AddUserToNodeHandler } from '@modules/nodes/events/add-user-to-node/add-user-to-node.handler';
import { AddUserToNodeEvent } from '@modules/nodes/events/add-user-to-node/add-user-to-node.event';
import { RemoveUserFromNodeHandler } from '@modules/nodes/events/remove-user-from-node/remove-user-from-node.handler';
import { RemoveUserFromNodeEvent } from '@modules/nodes/events/remove-user-from-node/remove-user-from-node.event';
import { SquadQuotasService } from './squad-quotas.service';
import { QuotaWebhooksService } from './quota-webhooks.service';

@Injectable()
export class QuotaMaintenanceService implements OnModuleInit, OnModuleDestroy {
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;
    private readonly logger = new Logger(QuotaMaintenanceService.name);
    constructor(private readonly db: PrismaService, private readonly quotas: SquadQuotasService, private readonly add: AddUserToNodeHandler, private readonly remove: RemoveUserFromNodeHandler, private readonly webhooks: QuotaWebhooksService) {}
    onModuleInit() {
        if (process.env.INSTANCE_TYPE !== 'scheduler') return;
        this.timer = setInterval(() => { void this.tick(); }, 5000);
    }
    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            await this.webhooks.deliver();
            // One atomic reset across ALL nodes for subscriptions using shared policies.
            const dueShared=await this.db.$queryRaw<{user_uuid:string}[]>`
                SELECT user_uuid FROM user_node_quota_preferences
                WHERE reset_at<=now() ORDER BY reset_at LIMIT 100`;
            for (const row of dueShared) await this.quotas.resetAll(row.user_uuid,true);
            const dueGroups=await this.db.$queryRaw<{user_uuid:string;id:string}[]>`
                SELECT g.user_uuid,g.id FROM user_node_quota_groups g
                WHERE g.reset_at<=now() AND NOT EXISTS(
                    SELECT 1 FROM user_node_quota_preferences p WHERE p.user_uuid=g.user_uuid
                ) ORDER BY g.reset_at LIMIT 100`;
            for(const group of dueGroups)await this.quotas.resetGroup(group.user_uuid,group.id,true);
            // Existing installations retain legacy per-node schedules until a shared
            // policy is explicitly configured. Do not silently alter old user quotas.
            const due = await this.db.$queryRaw<{ user_uuid: string; node_uuid: string }[]>`
                SELECT q.user_uuid,q.node_uuid FROM user_node_quotas q
                WHERE q.reset_at<=now() AND NOT EXISTS(
                    SELECT 1 FROM user_node_quota_preferences p WHERE p.user_uuid=q.user_uuid
                ) ORDER BY q.reset_at LIMIT 100`;
            for (const q of due) await this.quotas.reset(q.user_uuid, q.node_uuid, true);
            const pending = await this.db.$queryRaw<{ user_uuid: string; revision: bigint }[]>`SELECT user_uuid,revision FROM quota_sync ORDER BY updated_at LIMIT 100`;
            for (const row of pending) {
                try {
                    const user = await this.db.users.findUnique({ where: { uuid: row.user_uuid } });
                    if (!user) continue;
                    if (user.status === 'ACTIVE' && user.expireAt > new Date()) await this.add.handle(new AddUserToNodeEvent(user.uuid), true);
                    else await this.remove.handle(new RemoveUserFromNodeEvent(user.tId, user.vlessUuid), true);
                    await this.db.$executeRaw`DELETE FROM quota_sync WHERE user_uuid=${row.user_uuid}::uuid AND revision=${row.revision}`;
                } catch (error) { this.logger.warn(`Quota synchronization deferred for ${row.user_uuid}: ${String(error)}`); }
            }
        } catch (error) { this.logger.error(String(error)); }
        finally { this.busy = false; }
    }
}
