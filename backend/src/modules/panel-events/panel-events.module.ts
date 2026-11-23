import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { PanelEventsController, SslCertificatesController } from './panel-events.controller';
import { PanelEventsService } from './panel-events.service';
import { PanelEventsWorker } from './panel-events.worker';
import { PanelPushService } from './panel-push.service';
import { SslCertificatesService } from './ssl-certificates.service';

@Module({
    imports: [CqrsModule],
    controllers: [PanelEventsController, SslCertificatesController],
    providers: [PanelEventsService, PanelEventsWorker, PanelPushService, SslCertificatesService],
})
export class PanelEventsModule {}
