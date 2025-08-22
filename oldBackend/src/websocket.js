import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { MongoDBClient } from './mongoDBClient.js';

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });
console.log(`Current environment file: ${envFile} | Current environment: ${process.env.NODE_ENV}`);

const PORT = process.env.PORT_WS;

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
    cors: {
        origin: '*', // Adjust if you have specific domains
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    console.log('[WebSocket] Client connected:', socket.id);

    // Handle any custom events from the client if needed
    socket.on('insert_request', async (payload) => {
        try {
            // Insert into DB and get result
            const result = await insertIntoDatabase(payload);

            // Emit DB update event to all connected clients
            io.emit('db_update', {
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('[WebSocket] Error during insert_request:', error);

            // Emit error event back to requesting client only
            socket.emit('insert_error', {
                success: false,
                message: error.message
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('[WebSocket] Client disconnected:', socket.id);
    });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});