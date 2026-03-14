import { hashString as sharedHashString } from '@bemodest/utils';
import { validateSignature as sharedValidateSignature, compileChainRegexes as sharedCompileChainRegexes } from '@bemodest/utils';
import { COLLECTION_CHAINS, COLLECTION_ENTITES, COLLECTION_ADDRS, STATS_CUTOFF_MS, SNAPPER_API_SECRET } from '../config/env.js';
import logger from '../config/logger.js';

/**
 * Fetches chains with aggregated label counts
 * @param {object} dbClient - MongoDB client instance
 * @param {object} query - Query filter for chains
 * @returns {Promise<Array>} - Enriched chains
 */
export async function getChainsWithCounts(dbClient, query = {}) {
    return dbClient.getChainsWithCounts(COLLECTION_CHAINS, COLLECTION_ADDRS, query);
}

// Shared state for reports and SSE clients (Placeholders if not found elsewhere)
export const reports = {};
export const clients = [];

/**
 * Validates HMAC-SHA256 signature from Python snapper.
 * @param {string|undefined} signature - X-Signature header (hex)
 * @param {string|undefined} timestamp - X-Timestamp header (unix ms string)
 * @returns {boolean}
 */
export const validateSignature = (signature, timestamp) => {
    return sharedValidateSignature(signature, timestamp, SNAPPER_API_SECRET);
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
    return sharedHashString(str);
};

/**
 * Building coingeckoToDuneMapping dynamically from COLLECTION_CHAINS
 */
export async function getCoingeckoToDuneMapping(dbClient) {
    return dbClient.getCoingeckoToDuneMapping(COLLECTION_CHAINS);
}

/**
 * Building coingeckoToCAIP2Mapping dynamically from COLLECTION_CHAINS
 */
export async function getCoingeckoToCAIP2Mapping(dbClient) {
    return dbClient.getCoingeckoToCAIP2Mapping(COLLECTION_CHAINS);
}

/**
 * Building caip2ToGeckoTerminalMapping dynamically from COLLECTION_CHAINS
 */
export async function getCaip2ToGeckoTerminalMapping(dbClient) {
    return dbClient.getCaip2ToGeckoTerminalMapping(COLLECTION_CHAINS);
}

/**
 * Building caip2ToCoingeckoMapping dynamically from COLLECTION_CHAINS
 */
export async function getCaip2ToCoingeckoMapping(dbClient) {
    return dbClient.getCaip2ToCoingeckoMapping(COLLECTION_CHAINS);
}

/**
 * Enriches label data with entity images from labelEntities collection
 */
export async function enrichLabelsWithEntityImages(labels, dbClient) {
    return dbClient.enrichLabelsWithEntityImages(labels, COLLECTION_ENTITES);
}

/**
 * Compiles address regex patterns from chains into native RegExp objects.
 * Also generates regex fingerprints for compatibility checking.
 * @param {Array<object>} chains - Array of chain documents
 * @returns {{ chainRegexMap: Record<string, RegExp[]>, regexFingerprintMap: Record<string, string> }}
 */
export function compileChainRegexes(chains) {
    return sharedCompileChainRegexes(chains);
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
