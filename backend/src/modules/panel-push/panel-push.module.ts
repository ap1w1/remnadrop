import { Module } from '@nestjs/common';
import { PanelPushController } from './panel-push.controller';
import { PanelPushService } from './panel-push.service';

@Module({ controllers: [PanelPushController], providers: [PanelPushService] })
export class PanelPushModule {}
