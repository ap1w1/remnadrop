import { request } from 'node:https';
import webpush from 'web-push';
import { BrowserPushSubscription, pushEndpoint } from './panel-push.security';

/** Use the maintained Web Push implementation for RFC 8291 encryption/VAPID,
 * with a bounded HTTPS request and no redirects, cookies or response logging. */
export async function deliverWebPush(
    subscription: BrowserPushSubscription,
    payload: Record<string, unknown>,
    vapid: { subject: string; publicKey: string; privateKey: string },
    topic: string,
    urgent: boolean,
): Promise<void> {
    pushEndpoint(subscription.endpoint);
    const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
        vapidDetails: vapid,
        TTL: 3600,
        contentEncoding: 'aes128gcm',
        urgency: urgent ? 'high' : 'normal',
        topic,
    });
    await new Promise<void>((resolve, reject) => {
        let finished = false;
        let deadline: ReturnType<typeof setTimeout>;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            clearTimeout(deadline);
            if (error) reject(error); else resolve();
        };
        const req = request(details.endpoint, { method: 'POST', headers: details.headers, timeout: 8000 }, res => {
            let received = 0;
            res.on('data', (chunk: Buffer) => {
                received += chunk.length;
                if (received > 16_384) req.destroy(new Error('PUSH_RESPONSE_LIMIT'));
            });
            res.on('error', finish);
            res.on('end', () => {
                const status = res.statusCode ?? 502;
                if (status >= 200 && status < 300) finish();
                else finish(Object.assign(new Error('PUSH_PROVIDER_ERROR'), { statusCode: status }));
            });
        });
        deadline = setTimeout(() => req.destroy(new Error('PUSH_TIMEOUT')), 15_000);
        deadline.unref();
        req.once('timeout', () => req.destroy(new Error('PUSH_TIMEOUT')));
        req.once('error', finish);
        req.end(details.body);
    });
}
