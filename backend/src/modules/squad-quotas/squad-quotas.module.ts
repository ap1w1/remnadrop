import { MonitoringSettingsController } from './monitoring-settings.controller';
import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { SquadQuotasController } from './squad-quotas.controller';
import { SquadQuotasService } from './squad-quotas.service';
import { NodesModule } from '@modules/nodes/nodes.module';
import { QuotaMaintenanceService } from './quota-maintenance.service';
import { QuotaWebhooksService } from './quota-webhooks.service';
import { NodeHistoryService } from './node-history.service';
import { NodeHistoryController } from './node-history.controller';
import { NodeMetricAgentController } from './node-metric-agent.controller';
import { NodeMetricAlertsService } from './node-metric-alerts.service';

@Global()
@Module({ imports: [NodesModule, CqrsModule], controllers: [MonitoringSettingsController, SquadQuotasController, NodeHistoryController, NodeMetricAgentController], providers: [SquadQuotasService, QuotaMaintenanceService, QuotaWebhooksService, NodeHistoryService, NodeMetricAlertsService], exports: [SquadQuotasService] })
export class SquadQuotasModule {}
