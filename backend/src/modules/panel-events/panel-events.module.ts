import { Module } from '@nestjs/common';

import { WebhookLoggerQueueModule } from '@queue/notifications/webhook-logger/webhook-logger.module';

import { PanelEventsController } from './panel-events.controller';
import { PanelEventsJobsService } from './panel-events-jobs.service';
import { PanelEventsService } from './panel-events.service';
import { SslCertificatesController } from './ssl-certificates.controller';
import { SslCertificatesService } from './ssl-certificates.service';

@Module({
    imports: [WebhookLoggerQueueModule],
    controllers: [PanelEventsController, SslCertificatesController],
    providers: [PanelEventsService, SslCertificatesService, PanelEventsJobsService],
})
export class PanelEventsModule {}
