import { z } from 'zod';

/**
 * Zod schemas for ephemeral popup form drafts.
 * All fields are optional because the draft may be incomplete.
 */

export const DraftLabelFormSchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    comment: z.string().optional(),
    entity: z.string().optional(),
    track: z.boolean().optional(),
    chains: z.array(z.string()).optional(),
    aliases: z.array(z.object({ name: z.string(), chain: z.string() })).optional().default([]),
    editingAddr: z.string().optional(),
});

export const DraftEntityFormSchema = z.object({
    name: z.string().optional(),
    comment: z.string().optional(),
    track: z.boolean().optional(),
    image: z.string().optional(),
    imageFilename: z.string().optional(),
    editingId: z.string().optional(),
});

export const DraftChainFormSchema = z.object({
    name: z.string().optional(),
    namespace: z.string().optional(),
    reference: z.string().optional(),
    symbol: z.string().optional(),
    isTestnet: z.boolean().optional(),
    gasPrice: z.string().optional(),
    explorerPrefix: z.string().optional(),
    status: z.string().optional(),
    supersededBy: z.string().optional(),
    bgType: z.string().optional(),
    bgColorStart: z.string().optional(),
    bgColorMid: z.string().optional(),
    bgColorEnd: z.string().optional(),
    fontColor: z.string().optional(),
    regex: z.string().optional(),
    caseSensitive: z.boolean().optional(),
    rpcs: z.array(z.string()).optional(),
    wsRpcs: z.array(z.string()).optional(),
    annotations: z.record(z.string()).optional(),
    editingId: z.string().optional(),
});

export const ExtensionFormDraftSchema = z.object({
    labels: DraftLabelFormSchema.optional(),
    entities: DraftEntityFormSchema.optional(),
    chains: DraftChainFormSchema.optional(),
    activeTab: z.string().optional(),
});

export type DraftLabelForm = z.infer<typeof DraftLabelFormSchema>;
export type DraftEntityForm = z.infer<typeof DraftEntityFormSchema>;
export type DraftChainForm = z.infer<typeof DraftChainFormSchema>;
export type ExtensionFormDraft = z.infer<typeof ExtensionFormDraftSchema>;
