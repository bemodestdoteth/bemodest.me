import { COLLECTION_CHAINS, COLLECTION_ENTITES, COLLECTION_ADDRS } from '../config/env.js';
import logger from '../config/logger.js';

/**
 * Fetches chains with aggregated label counts
 * @param {object} dbClient - MongoDB client instance
 * @param {object} query - Query filter for chains
 * @returns {Promise<Array>} - Enriched chains
 */
export async function getChainsWithCounts(dbClient, query = {}) {
    const chains = await dbClient.readMany(COLLECTION_CHAINS, query);

    // Aggregate label counts per chain
    const labelCounts = await dbClient.aggregate(COLLECTION_ADDRS, [
        { $group: { _id: "$chain", count: { $sum: 1 } } }
    ]);

    // Create map for O(1) lookup
    const countMap = {};
    labelCounts.forEach(item => {
        if (item._id) countMap[item._id] = item.count;
    });

    // Normalize data
    return chains.map(chain => ({
        ...chain,
        code: chain.code || chain.chain,
        labelCount: countMap[chain.chain] || countMap[chain.code] || 0
    }));
}

// Shared state for reports and SSE clients (Placeholders if not found elsewhere)
export const reports = {};
export const clients = [];

/**
 * Validates a signature (Placeholder)
 */
export const validateSignature = (signature, timestamp) => {
    // TODO: Implement actual signature validation
    return true;
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

export const updateClients = () => {
    const data = JSON.stringify(calculateStats());
    clients.forEach(client => client.write(`data: ${data}\n\n`));
};

export const calculateStats = () => {
    const now = Date.now();
    const cutoff = now - 60 * 1000; // Last 1 minute
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
