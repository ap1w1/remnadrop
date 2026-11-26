import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { UsersModule } from '@modules/users/users.module';
import { SubscriptionTemplateModule } from '@modules/subscription-template/subscription-template.module';
import { SquadQuotasModule } from '@modules/squad-quotas/squad-quotas.module';
import { DpiCheckerService } from './dpi-checker.service';
import { DpiCredentialsService } from './dpi-credentials.service';
import { DpiCheckerController } from './dpi-checker.controller';
import { NodeIpService } from './node-ip.service';
import { NodeIpController } from './node-ip.controller';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { LimiterService } from './limiter.service';
import { LimiterOutboundWebhookService } from './limiter-outbound-webhook.service';
import { LimiterCredentialsService } from './limiter-credentials.service';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';
import { LimiterRunnerService } from './limiter-runner.service';
import { LimiterControlService } from './limiter-control.service';
import { LimiterController } from './limiter.controller';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { CloudflareDnsController, CloudflareDnsWebhookController } from './cloudflare-dns.controller';
import { DiskMetricsController } from './disk-metrics.controller';
import { LimiterBridgeController, LimiterBridgeGuard } from './limiter-bridge.controller';
import { LimiterWebhookController } from './limiter-webhook.controller';

@Module({
  imports:[CqrsModule,UsersModule,SubscriptionTemplateModule,SquadQuotasModule],
  providers:[DpiCheckerService,DpiCredentialsService,NodeIpService,CloudflareDnsService,AutomationsService,LimiterBridgeSecretsService,LimiterService,LimiterOutboundWebhookService,LimiterCredentialsService,LimiterRunnerService,LimiterControlService,LimiterBridgeGuard],
  controllers:[DpiCheckerController,NodeIpController,AutomationsController,LimiterController,CloudflareDnsController,CloudflareDnsWebhookController,DiskMetricsController,LimiterBridgeController,LimiterWebhookController],
})
export class NodeOperationsModule {}

