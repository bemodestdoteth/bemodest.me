import { z } from 'zod';

export const SidecarConfigPayloadType = z.enum([
    'excludelist_updated',
    'pinlist_updated',
    'alertrules_updated',
    'market_cache_updated',
]);

export const SidecarConfigPayloadSchema = z.object({
    type: SidecarConfigPayloadType,
});

export type SidecarConfigPayload = z.infer<typeof SidecarConfigPayloadSchema>;
