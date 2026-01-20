import express from 'express';
import { createServer } from 'http';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import logger from './config/logger.js';
import { PORT, CHROME_EXTENSION_ID } from './config/env.js';
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
    login,
    logout,
    checkSession,
    getExtensionToken,
    labelDelete
} from './routes/api.js';
import { sseConnect } from './utils/helpers.js';
import { checkSocketIOStatus } from './socket/index.js';

const app = express()
    .use(express.static(path.join(process.cwd(), 'public')))
    .use(express.json())
    .use(cookieParser())
    .use(rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 100,
        message: 'Too many requests from this IP, please try again after a minute'
    }))
    .use(cors({
        origin: ['http://localhost:25833', `chrome-extension://${CHROME_EXTENSION_ID}`],
        credentials: true
    }))
    .use(bodyParser.json({ limit: '50mb' }))
    .use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// REST API Routes
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), '/index.html')));
app.get('/ping', (req, res) => res.status(200).send('{ "message": "pong", "timestamp": ' + Date.now() + ' }'));
app.get('/status', (req, res) => res.sendFile(path.join(process.cwd(), '/public/status.html')));
app.get('/tracking', (req, res) => res.sendFile(path.join(process.cwd(), '/public/tracking.html')));
app.get('/events', (req, res) => sseConnect(req, res));
app.get('/api/session', checkSession);
app.get('/api/extension/token', getExtensionToken);
app.get('/api/entityTotal', authMiddleware, entityTotal);
app.get('/api/wallets', authMiddleware, walletList);
app.get('/api/walletTotal', authMiddleware, walletTotal);
app.get('/api/walletTracking', authMiddleware, walletTracking);

app.get('/entities', entityGet);
app.get('/coingecko', coingeckoGet);
app.get('/coingecko/solana', coingeckoGetSolana);
app.post('/labels/delete', labelDelete);
app.post('/api/removeFront', authMiddleware, removeFront);

app.post('/api/report', express.json(), getExchSnapperReport);
app.post('/login', login);
app.post('/logout', logout);

// Socket.IO Status (Optional)
app.get('/api/socket-status', checkSocketIOStatus);

const server = createServer(app);

// Initialize Socket.IO
initSocketIO(server);

server.listen(PORT, () => {
    logger.info(`Listening on ${PORT}`);
});
