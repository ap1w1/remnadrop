import { Injectable } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config/typed-config.service';
import { NotificationsConfigService } from '@common/config/common-config/notifications-config.service';
import type { TForkEvents } from '@libs/contracts/constants';
import { WebhookLoggerQueueService } from '@queue/notifications/webhook-logger/webhook-logger.service';

import { forkWebhookEnvelope, LegacyForkEvent } from './fork-webhook-envelope';

/** Submit fork events through the same settings, signature and queue as Remnawave events. */
@Injectable()
export class ForkWebhooksService {
    constructor(
        private readonly config: TypedConfigService,
        private readonly notifications: NotificationsConfigService,
        private readonly queue: WebhookLoggerQueueService,
    ) {}

    destinations(): string[] {
        if (!this.config.get('WEBHOOK_ENABLED')) return [];
        return (this.config.get('WEBHOOK_URL') ?? '')
            .split(',').map(url => url.trim()).filter(Boolean);
    }

    async enqueue(
        id: string,
        event: TForkEvents | LegacyForkEvent,
        timestamp: Date | string,
        data: unknown,
        destinations = this.destinations(),
    ): Promise<boolean> {
        const envelope = forkWebhookEnvelope(id, event, timestamp, data);
        if (!this.config.get('WEBHOOK_ENABLED') ||
            !this.notifications.isEnabled(envelope.event as TForkEvents, 'webhook') || !destinations.length) return false;
        await this.queue.sendWebhooks(
            { payload: JSON.stringify(envelope), timestamp: envelope.timestamp },
            destinations,
        );
        return true;
    }
}
