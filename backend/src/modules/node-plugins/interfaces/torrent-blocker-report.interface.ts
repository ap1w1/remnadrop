export interface ITorrentBlockerReport {
    device?: { hwid: string; platform: string | null; model: string | null; userAgent: string | null } | null;
    deviceIdentification?: { status: 'probable' | 'unknown'; method: 'ip'; candidateCount: number };
    knownDevices?: { hwid: string; platform: string | null; model: string | null; userAgent: string | null }[];
    knownDeviceCount?: number;
    subscriptionClient?: { userAgent: string } | null;
    actionReport: {
        blocked: boolean;
        ip: string;
        blockDuration: number;
        willUnblockAt: Date;
        userId: string;
        processedAt: Date;
    };
    xrayReport: {
        email: string | null;
        level: number | null;
        protocol: string | null;
        network: string;
        source: string | null;
        destination: string;
        routeTarget: string | null;
        originalTarget: string | null;
        inboundTag: string | null;
        inboundName: string | null;
        inboundLocal: string | null;
        outboundTag: string | null;
        ts: number;
    };
}
