import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

// JwtDefaultGuard used by BackupsController injects QueryBus.
// Importing CqrsModule here makes QueryBus available in this module's DI scope.
@Module({
  imports: [CqrsModule],
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
