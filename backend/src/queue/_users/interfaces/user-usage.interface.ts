export interface IUserUsageDelta {
    u: string;
    n: string;
    /** Subscription usage after the node's consumption multiplier. */
    b: string;
    /** Actual uplink + downlink bytes, independent of billing settings. */
    rawBytes?: string;
    /** A small sample can be ignored globally, but must still count towards node quotas. */
    skipGlobal?: boolean;
}
