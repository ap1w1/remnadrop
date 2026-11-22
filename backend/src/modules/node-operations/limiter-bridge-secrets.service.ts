import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/**
 * Ephemeral, per-panel-process credentials.
 * Only the in-container Go Limiter receives them via inherited environment.
 * No secrets to copy between Docker containers or expose to browsers.
 */
@Injectable()
export class LimiterBridgeSecretsService {
    readonly apiToken = randomBytes(32).toString('hex');
    readonly webhookSecret = randomBytes(32).toString('hex');
}
