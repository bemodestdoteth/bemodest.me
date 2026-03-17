import { logger } from './logger';
import { interpolateSecrets } from './config';

const rpcMap = new Map<string, { urls: string[], idx: number }>();
const chainIdToCAIP2 = new Map<number, string>();
const failureMap = new Map<string, any>();

const FAIL_THRESHOLD = 3;
const FAIL_WINDOW_MS = 60_000;
const COOLDOWN_MS = 120_000;

function isOnCooldown(url: string) {
    const entry = failureMap.get(url);
    if (!entry) return false;
    if (entry.cooldownUntil && Date.now() < entry.cooldownUntil) return true;
    return false;
}

export function reportRpcFailure(url: string) {
    const now = Date.now();
    const entry = failureMap.get(url) || { failCount: 0, windowStart: now, cooldownUntil: 0 };

    if (now - entry.windowStart > FAIL_WINDOW_MS) {
        entry.failCount = 0;
        entry.windowStart = now;
    }

    entry.failCount += 1;
    if (entry.failCount >= FAIL_THRESHOLD) {
        entry.cooldownUntil = now + COOLDOWN_MS;
        logger.warn(`[RPC] ${url} on cooldown until ${new Date(entry.cooldownUntil).toISOString()}`);
    }

    failureMap.set(url, entry);

    for (const [k, v] of failureMap.entries()) {
        if (v.cooldownUntil < now && now - v.windowStart > FAIL_WINDOW_MS) {
            failureMap.delete(k);
        }
    }
}

export function getRpcUrl(caip2Id: string | number): string | null {
    if (typeof caip2Id === 'number') {
        const mapped = chainIdToCAIP2.get(caip2Id);
        if (!mapped) return null;
        caip2Id = mapped;
    }

    const entry = rpcMap.get(caip2Id);
    if (!entry || entry.urls.length === 0) return null;

    const len = entry.urls.length;
    for (let i = 0; i < len; i++) {
        const url = entry.urls[(entry.idx + i) % len];
        if (!isOnCooldown(url)) {
            entry.idx = (entry.idx + i + 1) % len;
            return url;
        }
    }
    return entry.urls[0];
}

export interface RpcInitOptions {
    fetchChains: () => Promise<any[]>;
    fetchAllowedChainIds?: () => Promise<number[] | null>;
}

export async function initRpcManager(options: RpcInitOptions) {
    try {
        const docs = await options.fetchChains();
        for (const doc of docs) {
            const caip2 = doc.caip2;
            if (doc.chainId != null && !chainIdToCAIP2.has(doc.chainId)) {
                chainIdToCAIP2.set(doc.chainId, caip2);
            }
            const urls = interpolateSecrets(doc.rpc ?? [])
                .filter((u: any) => typeof u === 'string' && u.startsWith('http')) as string[];

            if (urls.length) {
                rpcMap.set(caip2, { urls: [...new Set(urls)], idx: 0 });
            }
        }
        logger.info(`[RPC] Seeded ${docs.length} chain(s) from DB`);
    } catch (err: any) {
        logger.error(`[RPC] DB seed failed: ${err.message}`);
    }

    let allowedChainIds: Set<number> | null = null;
    if (options.fetchAllowedChainIds) {
        try {
            const ids = await options.fetchAllowedChainIds();
            if (ids) allowedChainIds = new Set(ids);
            logger.info(`[RPC] Loaded ${allowedChainIds ? allowedChainIds.size : 0} allowed chain IDs`);
        } catch (err: any) {
            logger.warn(`[RPC] Allowed chain IDs load failed: ${err.message}`);
        }
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const resp = await fetch('https://chainlist.org/rpcs.json', { signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const list = await (resp.json() as Promise<any[]>);

        for (const chainObj of list) {
            const chainId = chainObj.chainId;
            if (allowedChainIds && !allowedChainIds.has(chainId)) continue;

            const caip2 = chainIdToCAIP2.get(chainId);
            if (!caip2) continue;

            const remoteUrls = (chainObj.rpc || [])
                .map((r: any) => (typeof r === 'string' ? r : r?.url))
                .filter((u: string) => u && u.startsWith('http') && !u.includes('${'))
                .slice(0, 3);

            if (remoteUrls.length > 0) {
                const entry = rpcMap.get(caip2) || { urls: [], idx: 0 };
                const merged = [...new Set([...remoteUrls, ...entry.urls])];
                rpcMap.set(caip2, { urls: merged, idx: 0 });
            }
        }
        logger.info('[RPC] chainlist.org RPCs loaded');
    } catch (err: any) {
        logger.warn(`[RPC] chainlist fetch failed: ${err.message}`);
    }
}
