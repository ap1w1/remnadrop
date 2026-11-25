import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { LimiterService } from './limiter.service';

/** Receives signed webhook payloads produced by the original syvlech Limiter 5.1.0. */
@Controller('limiter-webhook')
export class LimiterWebhookController {
  constructor(private readonly limiter:LimiterService){}
  @Post()
  @HttpCode(200)
  receive(
    @Req() request:Request & {rawBody?:Buffer},
    @Headers('x-timestamp') timestamp:string|undefined,
    @Headers('x-signature-v2') signature:string|undefined
  ){
    if(!request.rawBody||!timestamp||!signature)
      throw new BadRequestException('Signed webhook with raw JSON body required');
    return this.limiter.recordWebhook(request.rawBody,signature,timestamp);
  }
}
