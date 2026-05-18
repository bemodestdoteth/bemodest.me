import { logger } from '@bemodest/utils';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const { STATS_CUTOFF_MS } = config;

export const reports = {};
const clients = [];

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

export const updateClients = () => {
    const data = JSON.stringify(calculateStats());
    for (let i = clients.length - 1; i >= 0; i -= 1) {
        const client = clients[i];
        if (client.writableEnded || client.destroyed) {
            clients.splice(i, 1);
            continue;
        }

        try {
            client.write(`data: ${data}\n\n`);
        } catch (err) {
            clients.splice(i, 1);
            logger.warn(`[SSE] Removed failed client: ${err.message}`);
        }
    }
};

const calculateStats = () => {
    const now = Date.now();
    const cutoff = now - STATS_CUTOFF_MS;
    const stats = {};

    for (const target in reports) {
        const recentReports = reports[target].filter(report => report.timestamp >= cutoff);
        reports[target] = recentReports;
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
