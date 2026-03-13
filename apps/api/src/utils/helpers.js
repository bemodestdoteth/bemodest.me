import { createHmac, timingSafeEqual } from 'node:crypto';
import { COLLECTION_CHAINS, COLLECTION_ENTITES, COLLECTION_ADDRS, STATS_CUTOFF_MS, SNAPPER_API_SECRET } from '../config/env.js';
import logger from '../config/logger.js';

/**
 * Fetches chains with aggregated label counts
 * @param {object} dbClient - MongoDB client instance
 * @param {object} query - Query filter for chains
 * @returns {Promise<Array>} - Enriched chains
 */
export async function getChainsWithCounts(dbClient, query = {}) {
    const chains = await dbClient.readMany(COLLECTION_CHAINS, query);

    // Aggregate label counts per chain (unwind array → count each chain independently)
    const labelCounts = await dbClient.aggregate(COLLECTION_ADDRS, [
        { $unwind: "$chains" },
        { $group: { _id: "$chains", count: { $sum: 1 } } }
    ]);

    // Create map for O(1) lookup
    const countMap = {};
    labelCounts.forEach(item => {
        if (item._id) countMap[item._id] = item.count;
    });

    // Normalize data
    return chains.map(chain => ({
        ...chain,
        _id: chain._id.toString(),
        code: chain.annotation?.code || chain.chain, // preserve backward compatibility if needed locally
        labelCount: countMap[chain.caip2] || 0
    }));
}

// Shared state for reports and SSE clients (Placeholders if not found elsewhere)
export const reports = {};
export const clients = [];

const SIGNATURE_MAX_AGE_MS = 30_000;

/**
 * Validates HMAC-SHA256 signature from Python snapper.
 * @param {string|undefined} signature - X-Signature header (hex)
 * @param {string|undefined} timestamp - X-Timestamp header (unix ms string)
 * @returns {boolean}
 */
export const validateSignature = (signature, timestamp) => {
    if (!signature || !timestamp || !SNAPPER_API_SECRET) return false;
    const ts = Number(timestamp);
    if (isNaN(ts) || Date.now() - ts > SIGNATURE_MAX_AGE_MS) return false;
    const expected = createHmac('sha256', SNAPPER_API_SECRET).update(timestamp).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
};

/**
 * SSE Connection handler (Placeholder)
 */
export const sseConnect = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);
    logger.info(`[SSE] Client connected. Total clients: ${clients.length}`);

    req.on('close', () => {
        const index = clients.indexOf(res);
        if (index !== -1) {
            clients.splice(index, 1);
        }
        logger.info(`[SSE] Client disconnected. Total clients: ${clients.length}`);
    });
};

export const hashString = (str) => {
    const hash = crypto.createHash('sha256');
    hash.update(str);
    return hash.digest('hex');
};

/**
 * Building coingeckoToDuneMapping dynamically from COLLECTION_CHAINS
 */
export async function getCoingeckoToDuneMapping(dbClient) {
    const chainsResult = await dbClient.readMany(COLLECTION_CHAINS, {}, {
        projection: { "annotation.coingecko": 1, "annotation.dune": 1, "_id": 0 }
    });

    const mapping = {};
    chainsResult.forEach(chain => {
        if (chain.annotation?.coingecko && chain.annotation?.dune) {
            mapping[chain.annotation.coingecko] = chain.annotation.dune;
        }
    });
    return mapping;
}

/**
 * Building coingeckoToCAIP2Mapping dynamically from COLLECTION_CHAINS
 */
export async function getCoingeckoToCAIP2Mapping(dbClient) {
    const chainsResult = await dbClient.readMany(COLLECTION_CHAINS, {}, {
        projection: { "annotation.coingecko": 1, "caip2": 1, "_id": 0 }
    });

    const mapping = {};
    chainsResult.forEach(chain => {
        if (chain.annotation?.coingecko && chain.caip2) {
            mapping[chain.annotation.coingecko] = chain.caip2;
        }
    });
    return mapping;
}

/**
 * Building caip2ToGeckoTerminalMapping dynamically from COLLECTION_CHAINS
 */
export async function getCaip2ToGeckoTerminalMapping(dbClient) {
    const chainsResult = await dbClient.readMany(COLLECTION_CHAINS, {}, {
        projection: { "annotation.geckoterminal": 1, "caip2": 1, "_id": 0 }
    });

    const mapping = {};
    chainsResult.forEach(chain => {
        if (chain.annotation?.geckoterminal && chain.caip2) {
            mapping[chain.caip2] = chain.annotation.geckoterminal;
        }
    });
    return mapping;
}

/**
 * Building caip2ToCoingeckoMapping dynamically from COLLECTION_CHAINS
 */
export async function getCaip2ToCoingeckoMapping(dbClient) {
    const chainsResult = await dbClient.readMany(COLLECTION_CHAINS, {}, {
        projection: { "annotation.coingecko": 1, "caip2": 1, "_id": 0 }
    });

    const mapping = {};
    chainsResult.forEach(chain => {
        if (chain.annotation?.coingecko && chain.caip2) {
            mapping[chain.caip2] = chain.annotation.coingecko;
        }
    });
    return mapping;
}

/**
 * Enriches label data with entity images from labelEntities collection
 */
export async function enrichLabelsWithEntityImages(labels, dbClient) {
    if (!Array.isArray(labels) || labels.length === 0) return labels;

    const entities = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 0, name: 1, image: 1 } });
    const entityMap = {};
    entities.forEach(entity => {
        if (entity.name && entity.image) {
            entityMap[entity.name] = dbClient.base64ToDataURI(entity.image);
        }
    });

    labels.forEach(label => {
        if (label.entity && entityMap[label.entity]) {
            label.entityImage = entityMap[label.entity];
        }
    });

    return labels;
}

/**
 * Compiles address regex patterns from chains into native RegExp objects.
 * Also generates regex fingerprints for compatibility checking.
 * @param {Array<object>} chains - Array of chain documents
 * @returns {{ chainRegexMap: Record<string, RegExp[]>, regexFingerprintMap: Record<string, string> }}
 */
export function compileChainRegexes(chains) {
    const chainRegexMap = {};
    const regexFingerprintMap = {};

    chains.forEach(chainDoc => {
        if (chainDoc.caip2 && chainDoc.addrRegexPatterns && chainDoc.addrRegexPatterns.length > 0) {
            const baseFlags = chainDoc.addrCaseSensitive === false ? 'i' : '';
            chainRegexMap[chainDoc.caip2] = chainDoc.addrRegexPatterns.map(patternStr => {
                let finalPattern = patternStr;
                let finalFlags = baseFlags;

                if (patternStr.startsWith('/') && patternStr.lastIndexOf('/') > 0) {
                    const lastSlashIndex = patternStr.lastIndexOf('/');
                    finalPattern = patternStr.substring(1, lastSlashIndex);
                    const patternFlags = patternStr.substring(lastSlashIndex + 1);

                    const mergedFlags = new Set([...finalFlags, ...patternFlags]);
                    mergedFlags.delete('g');
                    mergedFlags.delete('y');
                    finalFlags = Array.from(mergedFlags).join('');
                } else {
                    const mergedFlags = new Set([...finalFlags]);
                    mergedFlags.delete('g');
                    mergedFlags.delete('y');
                    finalFlags = Array.from(mergedFlags).join('');
                }

                try {
                    return new RegExp(finalPattern, finalFlags);
                } catch (e) {
                    logger.error(`Invalid regex pattern for ${chainDoc.caip2}: ${patternStr}`);
                    return null;
                }
            }).filter(r => r !== null);

            // Build fingerprint for same-regex constraint
            regexFingerprintMap[chainDoc.caip2] = JSON.stringify([...chainDoc.addrRegexPatterns].sort());
        }
    });

    return { chainRegexMap, regexFingerprintMap };
}

export const updateClients = () => {
    const data = JSON.stringify(calculateStats());
    clients.forEach(client => client.write(`data: ${data}\n\n`));
};

export const calculateStats = () => {
    const now = Date.now();
    const cutoff = now - STATS_CUTOFF_MS;
    const stats = {};

    for (const target in reports) {
        const recentReports = reports[target].filter(report => report.timestamp >= cutoff);
        const successes = recentReports.filter(r => r.status === 'success').length;
        const failures = recentReports.filter(r => r.status === 'failure').length;
        const total = successes + failures;
        const successRate = total > 0 ? ((successes / total) * 100).toFixed(2) : 'N/A';

        stats[target] = {
            successRate,
            successes,
            failures
        };
    }

    return stats;
};
