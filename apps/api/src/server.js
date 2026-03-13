import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import logger from './config/logger.js';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const {
    PORT,
    CHROME_EXTENSION_ID,
    CORS_ORIGIN,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    BODY_PARSER_LIMIT
} = config;
const CORS_ORIGIN_ALLOWED = [CORS_ORIGIN];
const RATE_LIMIT_MESSAGE = 'Too many requests from this IP, please try again after a minute';
import { authMiddleware } from './middleware/auth.js';
import { initSocketIO } from './socket/index.js';
import {
    walletList,
    walletTotal,
    walletTracking,
    entityTotal,
    entityGet,
    coingeckoGet,
    coingeckoGetSolana,
    removeFront,
    getExchSnapperReport,
    getDeepDiveBalance,
    postDeepDiveStart,
    postDeepDiveStop,
    getAlertRules,
    createAlertRule,
    updateAlertRule,
    deleteAlertRule,
    resetWebhookDead,
    markWebhookDead,
    labelDelete,
    getExcludelist,
    updateExcludelist,
    getPinlist,
    updatePinlist,
    getMarketMetadata,
    postDwStatus,
    getDwStatus,
} from './routes/api.js';
import authRouter from './modules/auth/routes.js';
import { sseConnect } from './utils/helpers.js';
import { checkSocketIOStatus } from './socket/index.js';
import { getStatus } from './routes/status.js';
import { initRedis } from './utils/redis.js';
import { initDexPricePoller } from './utils/dexPricePoller.js';
import { initRpcManager } from './utils/rpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, '..', 'public');


const app = express();

// Enable trust proxy when behind reverse proxy (nginx)
// Set to 1 to trust only the first proxy hop (nginx)
app.set('trust proxy', 1);

app
    .use(express.static(publicDir))
    .use(express.json())
    .use(cookieParser())
    .use(rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
        message: RATE_LIMIT_MESSAGE
    }))
    .use(cors({
        origin: [...CORS_ORIGIN_ALLOWED, `chrome-extension://${CHROME_EXTENSION_ID}`],
        credentials: true
    }))
    .use(bodyParser.json({ limit: BODY_PARSER_LIMIT }))
    .use(bodyParser.urlencoded({ limit: BODY_PARSER_LIMIT, extended: true }));

// REST API Routes
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/ping', (req, res) => res.status(200).send('{ "message": "pong", "timestamp": ' + Date.now() + ' }'));
app.get('/status', (req, res) => res.sendFile(path.join(publicDir, 'status.html')));
app.get('/tracking', (req, res) => res.sendFile(path.join(publicDir, 'tracking.html')));
app.get('/events', (req, res) => sseConnect(req, res));
app.get('/api/entityTotal', authMiddleware, entityTotal);
app.get('/api/wallets', authMiddleware, walletList);
app.get('/api/walletTotal', authMiddleware, walletTotal);
app.get('/api/walletTracking', authMiddleware, walletTracking);
app.get('/api/status', getStatus);

app.get('/entities', entityGet);
app.get('/coingecko', coingeckoGet);
app.get('/coingecko/solana', coingeckoGetSolana);
app.post('/labels/delete', labelDelete);
app.post('/api/removeFront', authMiddleware, removeFront);

app.get('/api/config/excludelist', authMiddleware, getExcludelist);
app.post('/api/config/excludelist', authMiddleware, updateExcludelist);

app.get('/api/config/pinlist', getPinlist);
app.post('/api/config/pinlist', authMiddleware, updatePinlist);

app.get('/api/market/metadata', getMarketMetadata);

app.post('/api/report', express.json(), getExchSnapperReport);
app.use('/', authRouter);

app.post('/api/dw-status', postDwStatus);
app.get('/api/dw-status', getDwStatus);
app.get('/api/deep-dive/balance', authMiddleware, getDeepDiveBalance);
app.post('/api/deep-dive/start', authMiddleware, postDeepDiveStart);
app.post('/api/deep-dive/stop', authMiddleware, postDeepDiveStop);

// ── Alert Rules ──────────────────────────────────────────────────────────────
app.get('/api/alert-rules', authMiddleware, getAlertRules);
app.post('/api/alert-rules', authMiddleware, createAlertRule);
app.patch('/api/alert-rules/:id', authMiddleware, updateAlertRule);
app.delete('/api/alert-rules/:id', authMiddleware, deleteAlertRule);
app.patch('/api/alert-rules/:id/reset-webhook', authMiddleware, resetWebhookDead);
// Internal — called by sidecar, not protected by user auth (signed by SNAPPER_API_SECRET)
app.patch('/api/alert-rules/:id/mark-dead', markWebhookDead);

// Socket.IO Status (Optional)
app.get('/api/socket-status', checkSocketIOStatus);

const server = createServer(app);

// Initialize Socket.IO
initSocketIO(server);

// Initialize Redis
initRedis();

// Initialize Shared MongoDB (fire-and-forget, will connect on first use or here)
import { getDBClient, closeDBClient } from './services/db.js';
getDBClient().catch(err => logger.error('[DB] Failed to connect initially:', err));

// Initialize RPC Manager (fire-and-forget)
initRpcManager().catch(err => logger.error('[RPC] Init failed:', err));

// Initialize DEX Price Poller
initDexPricePoller();

// Graceful Shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await closeDBClient();
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await closeDBClient();
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

server.listen(PORT, () => {
    logger.info(`Listening on ${PORT}`);
});

