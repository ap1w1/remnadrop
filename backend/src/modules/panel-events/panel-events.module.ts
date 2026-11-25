import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { PanelEventsController, PanelUpdatesController, SslCertificatesController } from './panel-events.controller';
import { PanelUpdatesService } from './panel-updates.service';
import { PanelEventsService } from './panel-events.service';
import { PanelEventsWorker } from './panel-events.worker';
import { SslCertificatesService } from './ssl-certificates.service';

@Module({
    imports: [CqrsModule],
    controllers: [PanelEventsController, PanelUpdatesController, SslCertificatesController],
    providers: [PanelEventsService, PanelEventsWorker, PanelUpdatesService, SslCertificatesService],
})
export class PanelEventsModule {}
