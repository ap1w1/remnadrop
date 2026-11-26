import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { ForkWebhooksService } from './fork-webhooks.service';

type BackupResult = {
    id: string;
    target_id: string;
    name: string;
    provider: string;
    status: 'completed' | 'failed';
    file_name: string | null;
    size_bytes: bigint | null;
    sha256: string | null;
    error: string | null;
    finished_at: Date;
    webhook_attempts: number;
};

/** Host-side backups record results in PostgreSQL; the panel sends their webhooks. */
@Injectable()
export class BackupWebhooksService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BackupWebhooksService.name);
    private timer?: ReturnType<typeof setInterval>;
    private busy = false;

    constructor(private readonly db: PrismaService, private readonly webhooks: ForkWebhooksService) {}

    onModuleInit() {
        if (process.env.INSTANCE_TYPE !== 'scheduler') return;
        this.timer = setInterval(() => { void this.deliver(); }, 20_000);
        this.timer.unref();
        void this.deliver();
    }

    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

    async deliver() {
        if (this.busy || !this.webhooks.destinations().length) return;
        this.busy = true;
        try {
            const rows = await this.db.$queryRaw<BackupResult[]>`
                UPDATE backup_runs r SET webhook_lease_until=now()+interval '90 seconds',
                    webhook_attempts=webhook_attempts+1
                FROM backup_targets t WHERE t.id=r.target_id AND r.id IN (
                    SELECT pending.id FROM backup_runs pending
                    WHERE pending.webhook_enabled AND pending.status IN ('completed','failed')
                      AND pending.webhook_enqueued_at IS NULL AND pending.finished_at IS NOT NULL
                      AND pending.webhook_attempts<20 AND pending.webhook_next_attempt_at<=now()
                      AND (pending.webhook_lease_until IS NULL OR pending.webhook_lease_until<now())
                    ORDER BY pending.finished_at LIMIT 25 FOR UPDATE OF pending SKIP LOCKED
                ) RETURNING r.id,r.target_id,r.status,r.file_name,r.size_bytes,r.sha256,r.error,
                    r.finished_at,r.webhook_attempts,t.name,t.provider`;
            for (const row of rows) {
                try {
                    await this.webhooks.enqueue(row.id, `backup.${row.status}`, row.finished_at, {
                        targetId: row.target_id,
                        runId: row.id,
                        storageType: row.provider,
                        name: row.name,
                        fileName: row.file_name,
                        sizeBytes: row.size_bytes?.toString() ?? '0',
                        sha256: row.sha256 ?? '',
                        error: row.error ?? '',
                        occurredAt: row.finished_at.toISOString(),
                    });
                    await this.db.$executeRaw`UPDATE backup_runs SET webhook_enqueued_at=now(),
                        webhook_lease_until=NULL WHERE id=${row.id}::uuid`;
                } catch (error) {
                    const delay = Math.min(3600, 2 ** Math.min(row.webhook_attempts, 12));
                    await this.db.$executeRaw`UPDATE backup_runs SET webhook_lease_until=NULL,
                        webhook_next_attempt_at=now()+${delay}::int*interval '1 second'
                        WHERE id=${row.id}::uuid`;
                    this.logger.warn(`Backup webhook ${row.id}: ${String(error)}`);
                }
            }
        } catch (error) {
            this.logger.warn(`Backup webhook queue: ${String(error)}`);
        } finally {
            this.busy = false;
        }
    }
}
