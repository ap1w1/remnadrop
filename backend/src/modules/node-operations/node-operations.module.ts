import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { UsersModule } from '@modules/users/users.module';
import { SubscriptionTemplateModule } from '@modules/subscription-template/subscription-template.module';
import { DpiCheckerService } from './dpi-checker.service';
import { DpiCredentialsService } from './dpi-credentials.service';
import { DpiCheckerController } from './dpi-checker.controller';
import { NodeIpService } from './node-ip.service';
import { NodeIpController } from './node-ip.controller';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { LimiterService } from './limiter.service';
import { LimiterCredentialsService } from './limiter-credentials.service';
import { LimiterController } from './limiter.controller';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { CloudflareDnsController, CloudflareDnsWebhookController } from './cloudflare-dns.controller';
import { DiskMetricsController } from './disk-metrics.controller';
import { LimiterBridgeController, LimiterBridgeGuard } from './limiter-bridge.controller';
import { LimiterWebhookController } from './limiter-webhook.controller';

@Module({
  imports:[CqrsModule,UsersModule,SubscriptionTemplateModule],
  providers:[DpiCheckerService,DpiCredentialsService,NodeIpService,CloudflareDnsService,AutomationsService,LimiterService,LimiterCredentialsService,LimiterBridgeGuard],
  controllers:[DpiCheckerController,NodeIpController,AutomationsController,LimiterController,CloudflareDnsController,CloudflareDnsWebhookController,DiskMetricsController,LimiterBridgeController,LimiterWebhookController],
})
export class NodeOperationsModule {}
