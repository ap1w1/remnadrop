import { NextFunction, Request, Response } from 'express';

import { Logger } from '@nestjs/common';

import { isDevelopment } from '@common/utils/startup-app';

const logger = new Logger('ProxyCheckMiddleware');

export function proxyCheckMiddleware(req: Request, res: Response, next: NextFunction) {
    if (isDevelopment()) {
        return next();
    }

    // The embedded Limiter calls these two authenticated endpoints over loopback.
    // Use the TCP peer, never forwarded headers or req.ip, to identify that path.
    const peer = req.socket?.remoteAddress;
    const isLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    const isLimiterEndpoint = req.path === '/api/limiter-bridge' ||
        req.path.startsWith('/api/limiter-bridge/') ||
        req.path === '/api/limiter-webhook' || req.path === '/api/limiter-webhook/';
    if (isLoopback && isLimiterEndpoint) {
        // Controllers still enforce the per-process Bearer token / HMAC signature.
        return next();
    }

    const isProxy = Boolean(req.headers['x-forwarded-for']);
    const isHttps = Boolean(req.headers['x-forwarded-proto'] === 'https');

    logger.debug(
        `X-Forwarded-For: ${req.headers['x-forwarded-for']}, X-Forwarded-Proto: ${req.headers['x-forwarded-proto']}`,
    );

    if (!isHttps || !isProxy) {
        res.socket?.destroy();
        logger.error('Reverse proxy and HTTPS are required.');
        return;
    }

    return next();
}
