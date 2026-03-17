import { Server } from 'socket.io';
import { logger } from '@bemodest/utils';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const { CHROME_EXTENSION_ID, PORT, CORS_ORIGIN: CORS_ORIGIN_ALLOWED } = config;
import { socketAuthMiddleware } from '../middleware/auth.js';
import { setIO, getIO } from './state.js';
import {
    handleChainGet,
    handleChainInsert,
    handleChainUpdate,
    handleChainDelete,
    handleEntityGet,
    handleEntityInsert,
    handleEntityUpdate,
    handleEntityDelete,
    handleLabelGet,
    handleLabelInsert,
    handleLabelUpdate,
    handleWalletTrackingGet,
    handleWalletTotalGet,
    handleWalletsGet,
    handleEntityTotalGet,
    handleLabelInsertBulk
} from './handlers.js';

export const initSocketIO = (server) => {
    const io = new Server(server, {
        cors: {
            origin: [
                `chrome-extension://${CHROME_EXTENSION_ID}`,
                ...CORS_ORIGIN_ALLOWED,
                `http://localhost:${PORT}`
            ],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    setIO(io);

    io.use(socketAuthMiddleware);

    io.on('connection', (socket) => {
        logger.info(`[Socket.IO] Client connected: ${socket.id}. Total clients: ${io.engine.clientsCount}`);

        socket.onAny((event, ...args) => {
            if (!['walletTrackingGet', 'walletTotalGet', 'entityTotalGet', 'walletsGet', 'entityGet', 'chainGet'].includes(event)) {
                logger.info(`[Socket.IO Debug] Received event: ${event}, Payload: ${JSON.stringify(args)}`);
            }
        });

        socket.on('chainGet', (payload) => handleChainGet(socket, payload));
        socket.on('chainInsert', (payload) => handleChainInsert(socket, payload));
        socket.on('chainUpdate', (payload) => handleChainUpdate(socket, payload));
        socket.on('chainDelete', (payload) => handleChainDelete(socket, payload));
        socket.on('entityGet', (payload) => handleEntityGet(socket, payload));
        socket.on('entityInsert', (payload) => handleEntityInsert(socket, payload));
        socket.on('entityUpdate', (payload) => handleEntityUpdate(socket, payload));
        socket.on('entityDelete', (payload) => handleEntityDelete(socket, payload));
        socket.on('labelGet', (payload) => handleLabelGet(socket, payload));
        socket.on('labelInsert', (payload) => handleLabelInsert(socket, payload));
        socket.on('labelUpdate', (payload) => handleLabelUpdate(socket, payload));
        socket.on('labelInsertBulk', (payload) => handleLabelInsertBulk(socket, payload));
        socket.on('walletTrackingGet', () => handleWalletTrackingGet(socket));
        socket.on('walletTotalGet', () => handleWalletTotalGet(socket));
        socket.on('walletsGet', () => handleWalletsGet(socket));
        socket.on('entityTotalGet', () => handleEntityTotalGet(socket));

        socket.on('disconnect', (reason) => {
            logger.warn(`[Socket.IO] Client disconnected: ${socket.id}. Reason: ${reason}`);
        });

        socket.on('error', (err) => {
            logger.error(`[Socket.IO] Connection error for socket ${socket.id}:`, err.message);
        });
    });

    return io;
};

export const checkSocketIOStatus = (req, res) => {
    try {
        const io = getIO();
        const clientsCount = io ? io.engine.clientsCount : 0;
        logger.info('[Socket.IO] Clients connected:', clientsCount);
        res.status(200).json({
            status: 'Socket.IO server is up',
            clients: clientsCount
        });
    } catch (error) {
        res.status(500).json({
            status: 'Error checking Socket.IO server status',
            error: error.message
        });
    }
};
