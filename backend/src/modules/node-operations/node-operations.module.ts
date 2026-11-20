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

@Module({
  imports:[CqrsModule,UsersModule,SubscriptionTemplateModule],
  providers:[DpiCheckerService,DpiCredentialsService,NodeIpService,AutomationsService],
  controllers:[DpiCheckerController,NodeIpController,AutomationsController],
})
export class NodeOperationsModule {}
