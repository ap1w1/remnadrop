import { z } from 'zod';

import { ExtendedUsersSchema } from './extended-users.schema';
import { NodesSchema } from './nodes.schema';

export const TorrentBlockerReportSchema = z.object({
    id: z.number(),
    userId: z.number(),
    nodeId: z.number(),
    user: ExtendedUsersSchema.pick({
        uuid: true,
        username: true,
    }),
    node: NodesSchema.pick({
        uuid: true,
        name: true,
        countryCode: true,
    }),
    report: z.object({
        device: z.object({hwid:z.string(),platform:z.string().nullable(),model:z.string().nullable(),userAgent:z.string().nullable()}).nullable().optional(),
        deviceIdentification: z.object({status:z.enum(['probable','unknown']),method:z.literal('ip'),candidateCount:z.number().int().nonnegative()}).optional(),
        knownDevices: z.array(z.object({hwid:z.string(),platform:z.string().nullable(),model:z.string().nullable(),userAgent:z.string().nullable()})).optional(),
        knownDeviceCount: z.number().int().nonnegative().optional(),
        subscriptionClient: z.object({userAgent:z.string()}).nullable().optional(),
        actionReport: z.object({
            blocked: z.boolean(),
            ip: z.string(),
            blockDuration: z.number(),
            willUnblockAt: z
                .string()
                .datetime({ offset: true, local: true })
                .transform((str) => new Date(str)),
            userId: z.string(),
            processedAt: z
                .string()
                .datetime({ offset: true, local: true })
                .transform((str) => new Date(str)),
        }),
        xrayReport: z.object({
            email: z.string().nullable(),
            level: z.number().nullable(),
            protocol: z.string().nullable(),
            network: z.string(),
            source: z.string().nullable(),
            destination: z.string(),
            routeTarget: z.string().nullable(),
            originalTarget: z.string().nullable(),
            inboundTag: z.string().nullable(),
            inboundName: z.string().nullable(),
            inboundLocal: z.string().nullable(),
            outboundTag: z.string().nullable(),
            ts: z.number(),
        }),
    }),
    createdAt: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
});
