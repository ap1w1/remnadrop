import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles } from '@common/decorators/roles/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';
import { BackupsService } from './backups.service';

@Controller('backups')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard,RolesGuard)
export class BackupsController {
  constructor(private readonly service:BackupsService) {}
  @Get() list(){return this.service.list();}
  @Post('targets') create(@Body() body:Record<string,unknown>){return this.service.create(body);}
  @Patch('targets/:id') update(@Param('id') id:string,@Body() body:Record<string,unknown>){return this.service.update(id,body);}
  @Post('targets/:id/run') run(@Param('id') id:string){return this.service.trigger(id);}
  @Delete('targets/:id') disable(@Param('id') id:string){return this.service.remove(id);}
}
