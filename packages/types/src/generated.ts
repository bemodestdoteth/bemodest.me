export interface AlertRule {
    _id:            string;
    condition:      Condition;
    cooldown_secs:  number;
    created_at?:    Date;
    enabled:        boolean;
    exchanges:      string[];
    label:          string;
    quote:          string;
    recovery_value: number;
    ticker:         string;
    updated_at?:    Date;
    value:          number;
    webhook_dead:   boolean;
    webhook_url:    string;
    [property: string]: any;
}

export enum Condition {
    ChangePct5M = "change_pct_5m",
    PriceAbove = "price_above",
    PriceBelow = "price_below",
    SpreadPct = "spread_pct",
    VolumeSpike = "volume_spike",
}

export interface SidecarConfigPayload {
    type: Type;
    [property: string]: any;
}

export enum Type {
    AlertrulesUpdated = "alertrules_updated",
    ExcludelistUpdated = "excludelist_updated",
    PinlistUpdated = "pinlist_updated",
}
