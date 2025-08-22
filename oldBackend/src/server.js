import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import session from 'express-session';
import winston from 'winston';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MongoDBClient } from './mongoDBClient.js';
import { Console } from 'console';

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });
console.log(`Current environment file: ${envFile} | Current environment: ${process.env.NODE_ENV}`);

const PORT = process.env.PORT;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DB_ADDR = process.env.DB_ADDR;
const DB_CHAINS = process.env.DB_CHAINS;
const DB_COINGECKO_RANK = process.env.DB_COINGECKO_RANK;
const DB_COINGECKO_LIST = process.env.DB_COINGECKO_LIST;
const DB_SONARWATCH_LIST = process.env.DB_SONARWATCH_LIST;
const DB_ENTITIES = process.env.DB_ENTITIES;
const WS_ORIGIN = process.env.WS_ORIGIN;

// Winston logger setting
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] | ${level} | ${message}`;
        })
      )
    }),
    new winston.transports.File({ filename: process.env.LOG_FILE || 'server.log' })
  ]
});

/************************/
/**HTML Handling Starts**/
/************************/
// Replace functions below with labelGet
const walletList = async (req, res) => {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), LABEL_KEY), 'utf-8');
    const parsedData = JSON.parse(data);
    res.status(200).json(parsedData);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ message: err });
  }
};

const walletTotal = async (req, res) => {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), LABEL_KEY), 'utf-8');
    const parsedData = JSON.parse(data);
    const total = Object.keys(parsedData[process.env.LABELLED_ADDRESSES_KEY]).length;
    res.status(200).json({ walletTotal: total });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ message: err });
  }
}

const walletTracking = async (req, res) => {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), LABEL_KEY), 'utf-8');
    const parsedData = JSON.parse(data);
    const total = Object.keys(parsedData[process.env.LABELLED_ADDRESSES_KEY]).filter(key => parsedData[process.env.LABELLED_ADDRESSES_KEY][key]['tracking']).length;
    res.status(200).json({ walletTracking: total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err });
  }
}

const entityTotal = async (req, res) => {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), ENTITY_KEY), 'utf-8');
    const parsedData = JSON.parse(data);
    const total = Object.keys(parsedData[process.env.ENTITY_ADDRESSES_KEY]).length;
    res.status(200).json({ entityTotal : total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err });
  }
}
/**********************/
/**HTML Handling Ends**/
/**********************/

/**********************/
/**API Server Starts**/
/**********************/
const hashString = (str) => {
  const hash = crypto.createHash('sha256');
  hash.update(str);
  return hash.digest('hex');
}

const coingeckoGet = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const rankResult = await dbClient.readMany(DB_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0},
            }
        );
        const listResult = await dbClient.readMany(DB_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );
        await dbClient.close();

        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });

        const finalResult = [];
        const coingeckoToDuneMapping = {
            "ethereum": "ethereum",
            "binance-smart-chain": "bnb",
            "polygon-pos": "polygon",
            "avalanche": "avalanche_c",
            "arbitrum-one": "arbitrum",
            "optimistic-ethereum": "optimism",
            "fantom": "fantom",
            "xdai": "gnosis",
            "celo": "celo",
            "base": "base",
            "scroll": "scroll",
            "zora": "zora",
            "zksync": "zksync",
            "mantle": "mantle",
            "blast": "blast",
        }
        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id); // Lookup in constant time

            if (Object.keys(platforms).length > 0) {
                for(const [key, value] of Object.entries(platforms)) {
                    if ((Object.keys(coingeckoToDuneMapping).includes(key)) && (value !== null)) {
                        finalResult.push({
                            id: obj1.id,
                            name: obj1.name,
                            symbol: obj1.symbol,
                            image: obj1.image,
                            current_price: obj1.current_price,
                            market_cap_rank: obj1.market_cap_rank,
                            price_change_percentage_24h: obj1.price_change_percentage_24h,
                            platform: coingeckoToDuneMapping[key],
                            contract: value.contract_address,
                            decimals: value.decimal_place,
                        });
                    }
                }
            }
        });

        res.status(200).json(finalResult);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err });
    }
}
const coingeckoGetSolana = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const rankResult = await dbClient.readMany(DB_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0},
             }
        );
        const listResult = await dbClient.readMany(DB_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );
        await dbClient.close();
  
        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });
  
        const finalResult = [];
        const coingeckoToDuneMapping = {
            "solana": "solana",
        }
        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id); // Lookup in constant time
  
            if (Object.keys(platforms).length > 0) {
                for(const [key, value] of Object.entries(platforms)) {
                    if ((Object.keys(coingeckoToDuneMapping).includes(key)) && (value !== null)) {
                        finalResult.push({
                            id: obj1.id,
                            symbol: obj1.symbol,
                            current_price: obj1.current_price,
                            market_cap_rank: obj1.market_cap_rank,
                            price_change_percentage_24h: obj1.price_change_percentage_24h,
                            platform: coingeckoToDuneMapping[key],
                            contract: value.contract_address,
                            decimals: value.decimal_place,
                          });
                    }
                }
            }
        });
  
        res.status(200).json(finalResult);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err });
    }
}
/********************/
/** API Server Ends**/
/********************/


/***********************/
/**Dune Webhook Starts**/
/***********************/


/**********************/
/**Dune Webhook Ends**/
/*********************/

/************************/
/**Server Status Starts**/
/************************/

const getExchSnapperReport = async (req, res) => {
  /* Body Structure
    {
      "timestamp": "2023-10-05T12:34:56Z",  // ISO 8601 format
      "from": "binance"                     // target
      "status": "success"                   // or "failure"
    }
  */
  // Validate the received signature
  if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'))) {
    res.status(401).json({ message: 'Invalid signature.' });
    return;
  }

  const { timestamp, from, status } = req.body;
  if (!timestamp || !from || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const time = new Date(timestamp).getTime();
  if (isNaN(time)) {
    return res.status(400).json({ error: 'Invalid timestamp' });
  }

  // Initialize target if not exists
  if (!reports[from]) {
    reports[from] = [];
  }

  // Add the report
  reports[from].push({ timestamp: time, status });

  // Acknowledge receipt
  res.json({ success: true });

  // Notify clients about the update
  updateClients();
};

// Function to update clients
const updateClients = () => {
    const data = JSON.stringify(calculateStats());
    clients.forEach(client => client.write(`data: ${data}\n\n`));
}

// Function to calculate stats
const calculateStats = () => {
    const now = Date.now();
    const cutoff = now - 60 * 1000; // Last 1 minute
    const stats = {};

    for (const target in reports) {
        // Filter reports within last minute
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
}
/**********************/
/**Server Status Ends**/
/**********************/

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, process.cwd())
    },
    filename: function (req, file, cb) {
        cb(null, LABEL_KEY)
    },
    filename: function (req, file, cb) {
        cb(null, ENTITY_KEY)
    }
})

const upload = multer({ storage: storage })

/****************************/
/** Auth middleware Starts **/
/****************************/
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

const login = async (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        req.session.authenticated = true;
        req.session.user = username;
        req.session.lastLogin = new Date();
        // Save session explicitly
        req.session.save((err) => {
        if (err) {
            res.status(500).json({ success: false, error: 'Session save failed' });
        } else {
            res.status(200).json({ 
            success: true,
            user: username,
            lastLogin: req.session.lastLogin
            });
        }
        });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials'});
    }
}

const logout = async (req, res) => {
    req.session.destroy();
    res.status(200).json({ message: 'Logout successful' });
}

const checkSession = async (req, res) => {
    if (req.session && req.session.authenticated) {
        res.status(200).json({
        authenticated: true,
        user: req.session.user,
        lastLogin: req.session.lastLogin
        });
    } else {
        res.status(401).json({ authenticated: false });
    }
};
/**************************/
/** Auth middleware Ends **/
/**************************/

// Main body of the server (ExpressJS)
const app = express()
    .use(express.static(path.join(process.cwd(), 'public')))
    .use(express.json())
    .use(cookieParser())
    .use(session({
    secret: SESSION_SECRET,
    resave: true,                 // Changed to true
    saveUninitialized: true,      // Changed to true
    rolling: true,                // Add this to refresh session with each request
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 60 * 60 * 1000, // 1 hour in milliseconds
        sameSite: 'strict'    // Protect against CSRF
    }
    }))
    .use(rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 100,
        message: 'Too many requests from this IP, please try again after a minute'
    }))
    .use(bodyParser.json({limit: '50mb'}))
    .use(bodyParser.urlencoded({limit: '50mb', extended: true}))
    .get('/', (req, res) => res.sendFile(path.join(process.cwd(), '/index.html')))
    .get('/ping', (req, res) => res.status(200).send('{ "message": "pong", "timestamp": ' + Date.now() + ' }'))
    .get('/status', (req, res) => res.sendFile(path.join(process.cwd(), '/public/status.html')))
    .get('/events', (req, res) => sseConnect(req, res))
    .get('/ping', (req, res) => res.status(200).send('pong'))
    .get('/api/session', (req, res) => { checkSession(req, res) })
    .get('/api/entityTotal', requireAuth, (req, res) => { entityTotal(req, res) })
    .get('/api/wallets', requireAuth, (req, res) => { walletList(req, res) })
    .get('/api/walletTotal', requireAuth, (req, res) => { walletTotal(req, res) })
    .get('/api/walletTracking', requireAuth, (req, res) => { walletTracking(req, res) })

    .get('/entities', (req, res) => { entityGet(req, res) })
    .get('/coingecko', (req, res) => { coingeckoGet(req, res) })
    .get('/coingecko/solana', (req, res) => { coingeckoGetSolana(req, res) })
    .post('/labels/insert', (req, res) => { labelInsert(req, res) })
    .post('/labels/delete', (req, res) => { labelDelete(req, res) })

    .get('/status/websocket', (req, res) => { checkWebSocketStatus(req, res) })

    .post('/api/report', express.json(), getExchSnapperReport)
    .post('/login', (req, res) => { login(req, res) })
    .post('/logout', (req, res) => { logout(req, res) })

const server = createServer(app);

/****************************/
/** Helper Function Starts **/
/****************************/

const sendErrorResponse = (ws, event, message) => {
    ws.send(JSON.stringify({
        event,
        message,
        timestamp: Date.now()
    }));
};
const basicAuth = (payload, receivedSignature, receivedTimestamp, threshold = 30) => {
    // Header valiadation
    if (!payload.headers || !payload.headers['X-Signature'] || !payload.headers['X-Timestamp']) {
        return {
            valid: false,
            success: false,
            message: 'Missing required headers: X-Signature, X-Timestamp'
        };
    }

    // Timestamp validation
    const serverTimeStamp = Math.floor(Date.now() / 1000).toString();
    if ((serverTimeStamp - receivedTimestamp) > threshold) {
        return {
            valid: false,
            success: false,
            message: 'Timestamp is too old.'
        };
    } else if ((receivedTimestamp - serverTimeStamp) > threshold) {
        return {
            valid: false,
            success: false,
            message: 'Timestamp is too new.'
        };
    }

    // Signature validation
    const serverSignature = hashString(SESSION_SECRET + receivedTimestamp);
    if (serverSignature !== receivedSignature) {
        return {
            valid: false,
            success: false,
            message: 'Invalid signature.'
        }
    }

    return { valid: true };
}
const withBasicAuth = (fn) => {
    return async (ws, payload, wss) => {
        const authResult = basicAuth(payload, payload.headers['X-Signature'], payload.headers['X-Timestamp']);
        if (!authResult.valid) {
            logger.error(`[WebSocket] Client ${ws._socket.remoteAddress} auth error:`, authResult.message);
            sendErrorResponse(ws, 'auth_error', authResult.message);
            return;
        }
        await fn(ws, payload, wss);
    };
};    

/****************************/
/** Helper Function Ends **/
/****************************/


/*****************************/
/** Socket.IO Server Starts **/
/*****************************/
import { Server } from 'socket.io';

// 1. Initialize Socket.IO Server
const io = new Server(server, {
    cors: {
        origin: "chrome-extension://YOUR_EXTENSION_ID", // IMPORTANT: Restrict to your extension ID
        methods: ["GET", "POST"]
    },
    // Socket.IO has built-in ping/pong for connection health, making manual timeouts unnecessary.
});

// 2. Middleware for Authentication (Replaces withBasicAuth wrapper)
io.use(async (socket, next) => {
    // This is where you adapt your 'withBasicAuth' logic.
    // For example, reading a token from the initial handshake.
    const token = socket.handshake.auth.token;

    if (token) {
        // Your validation logic here. If valid, call next().
        // For demonstration, we'll assume it's valid.
        // In a real app, you would verify the JWT here.
        console.log(`[Socket.IO] Authenticated socket ${socket.id}`);
        next();
    } else {
        // If authentication fails.
        console.error(`[Socket.IO] Unauthenticated connection attempt from socket ${socket.id}`);
        next(new Error("Authentication error"));
    }
});


// 3. Central Connection Handler
io.on('connection', (socket) => {
    logger.info(`[Socket.IO] Client connected: ${socket.id}. Total clients: ${io.engine.clientsCount}`);

    // 4. Event-based Listeners (Replaces the large if/else block)
    socket.on('chainGet', (payload) => handleChainGet(socket, payload));
    socket.on('entityGet', (payload) => handleEntityGet(socket, payload));
    socket.on('labelGet', (payload) => handleLabelGet(socket, payload));
    socket.on('labelInsert', (payload) => handleLabelInsert(socket, payload));
    socket.on('labelDelete', (payload) => handleLabelDelete(socket, payload));

    // Handle disconnection
    socket.on('disconnect', (reason) => {
        logger.warn(`[Socket.IO] Client disconnected: ${socket.id}. Reason: ${reason}`);
    });

    // Handle errors
    socket.on('error', (err) => {
        logger.error(`[Socket.IO] Connection error for socket ${socket.id}:`, err.message);
    });
});

// 5. Refactored Handler Functions
// Note: We no longer pass 'ws' or 'wss'. The 'socket' object handles client-specific responses,
// and 'io' handles broadcasting to everyone.

async function handleChainGet(socket, payload) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent chainGet request: ${JSON.stringify(payload)}`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_CHAINS, payload.params, { projection: { _id: 0 } });
        await dbClient.close();

        // Broadcast result to ALL connected clients using Socket.IO's clean API
        io.emit('chainUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] chainGet Error:', err);
        // Send error back to the *requesting* client only
        socket.emit('get_error', { error: `Failed to fetch chains: ${err.message || err}` });
    }
}

async function handleEntityGet(socket, payload) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent entityGet request: ${JSON.stringify(payload)}`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_ENTITIES, payload.params, { projection: { _id: 0 } });
        await dbClient.close();

        // Broadcast to all clients
        io.emit('entityUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] entityGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch entities: ${err.message || err}` });
    }
}

async function handleLabelGet(socket, payload) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent labelGet request: ${JSON.stringify(payload)}`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_ADDR, payload.params, { projection: { _id: 0 } });
        await dbClient.close();

        // Broadcast to all clients
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch labels: ${err.message || err}` });
    }
}

async function handleLabelInsert(socket, payload) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent labelInsert request: ${JSON.stringify(payload)}`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        await dbClient.createOne(DB_ADDR, payload.body);
        const result = await dbClient.readMany(DB_ADDR, {}, { projection: { _id: 0 } });
        await dbClient.close();

        // Broadcast the full updated list to ALL clients
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        // Send a specific success message back to the originator
        socket.emit('success', {
            data: `Successfully inserted new label: ${payload.body.addr}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelInsert Error:', err);
        socket.emit('failure', { error: `Failed to insert new label: ${err.message || err}` });
    }
}

async function handleLabelDelete(socket, payload) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent labelDelete request: ${JSON.stringify(payload)}`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        await dbClient.deleteOne(DB_ADDR, payload.body); // Original code sent back the result, but deleteOne often returns a confirmation count. Fetching the new list is more robust.
        const result = await dbClient.readMany(DB_ADDR, {}, { projection: { _id: 0 } });
        await dbClient.close();

        // Broadcast the full updated list to ALL clients
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        // Send a specific success message back to the originator
        socket.emit('success', {
            data: `Successfully deleted label: ${payload.body.addr}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelDelete Error:', err);
        socket.emit('failure', { error: `Failed to delete label: ${err.message || err}` });
    }
}

// Optional: You can still have a status endpoint if needed for monitoring.
const checkSocketIOStatus = (req, res) => {
    try {
        const clientsCount = io.engine.clientsCount;
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

/***************************/
/** Socket.IO Server Ends  **/
/***************************/

/**************************************/
/** Websocket Server (Legacy) Starts **/
/**************************************/
const wss = new WebSocketServer({ server });
const HANDSHAKE_TIMEOUT_MS = 60 * 1000; // 1 minute

/**
 * Periodically check each client for stale connections
 */
setInterval(() => {
    wss.clients.forEach((client) => {
        // If we haven't received any handshake from this client in too long, close it
        if (
            client.readyState === WebSocket.OPEN &&
            client.lastHandshakeTime &&
            Date.now() - client.lastHandshakeTime > HANDSHAKE_TIMEOUT_MS
        ) {
            console.warn(
                `[WebSocket] Closing stale connection for client (no handshake in ${
                    HANDSHAKE_TIMEOUT_MS / 1000
                }s).`
            );
            client.close(4000, 'Handshake Timeout'); // 4000 is a custom close code
        }
    });
}, 15 * 1000); // Check every 15 seconds (adjust as needed)

const checkWebSocketStatus = (req, res) => {
    try {
        // `wss.clients` is a Set of all connected clients
        const clientsCount = wss.clients.size;
        logger.info('[WebSocket] Clients connected:', clientsCount);

        if (clientsCount > 0) {
            res.status(200).json({
                status: 'WebSocket server is up',
                clients: clientsCount
            });
        } else {
            res.status(200).json({
                status: 'WebSocket server is up, but no clients connected'
            });
        }
    } catch (error) {
        res.status(500).json({
            status: 'Error checking WebSocket server status',
            error: error.message
        });
    }
};
const chainGet = withBasicAuth(async (ws, payload, wss) => {
    try {
        logger.info(`[WebSocket] Client ${ws._socket.remoteAddress} sent chain-get request: ${JSON.stringify(payload)}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_CHAINS, payload.params, {projection: { _id: 0 }});
        await dbClient.close();

        // Broadcast result to ALL connected clients, if desired
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log(`[WebSocket] Sending chain update response to client ${client._socket.remoteAddress}`);
                client.send(JSON.stringify({
                    event: 'chainUpdate',
                    success: true,
                    data: result,
                    timestamp: Date.now()
                }));
            }
        });
    } catch (err) {
        logger.error('[WebSocket] chain-get Error:', err);
        // Send error back to the **requesting** client only
        sendErrorResponse(ws, 'get_error', `Failed to fetch chains: ${err.message || err}`);
    }
});
const entityGet = withBasicAuth(async (ws, payload, wss) => {
    try {
        logger.info(`[WebSocket] Client ${ws._socket.remoteAddress} sent entity-get request: ${JSON.stringify(payload)}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_ENTITIES, payload.params, {projection: { _id: 0 }});
        await dbClient.close();

        // Broadcast result to ALL connected clients, if desired
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log(`[WebSocket] Sending entity update response to client ${client._socket.remoteAddress}`);
                client.send(JSON.stringify({
                    event: 'entityUpdate',
                    success: true,
                    data: result,
                    timestamp: Date.now()
                }));
            }
        });
    } catch (err) {
        logger.error('[WebSocket] entity-get Error:', err);
        // Send error back to the **requesting** client only
        sendErrorResponse(ws, 'get_error', `Failed to fetch entities: ${err.message || err}`);
    }
});
const labelGet = withBasicAuth(async (ws, payload, wss) => {
    try {
        logger.info(`[WebSocket] Client ${ws._socket.remoteAddress} sent label-get request: ${JSON.stringify(payload)}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(DB_ADDR, payload.params, {projection: { _id: 0 }},);
        await dbClient.close();

        // Broadcast result to ALL connected clients, if desired
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log(`[WebSocket] Sending label update response to client ${client._socket.remoteAddress}`);
                client.send(JSON.stringify({
                    event: 'labelUpdate',
                    success: true,
                    data: result,
                    timestamp: Date.now()
                }));
            }
        });
    } catch (err) {
        logger.error('[WebSocket] label-get Error:', err);
        // Send error back to the **requesting** client only
        sendErrorResponse(ws, 'get_error', `Failed to fetch labels: ${err.message || err}`);
    }
});
const labelInsert = withBasicAuth(async (ws, payload, wss) => {
    /**
     * body = {
     *   "addr": "0x1234",
     *   "label": "My Wallet",
     *   "chain": "ETH",
     *   "entity": "My Entity",
     *   "tracking": 1,
     *   "comment": "My Comment"
     * }
     */
    try {
        logger.info(`[WebSocket] Client ${ws._socket.remoteAddress} sent label-insert request: ${JSON.stringify(payload)}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        await dbClient.createOne(DB_ADDR, payload.body);
        const result = await dbClient.readMany(DB_ADDR, {}, {projection: { _id: 0 }});
        await dbClient.close();

        // Broadcast update to ALL connected clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log(`[WebSocket] Sending label update response to client ${client._socket.remoteAddress}`);
                client.send(JSON.stringify({
                    event: 'labelUpdate',
                    success: true,
                    data: result,
                    timestamp: Date.now()
                }));
            }
        });
        // Broadcast result to the **requesting** client only
        ws.send(JSON.stringify({
            event: 'success',
            success: true,
            data: `Successfully inserted new label: ${payload.body.addr}`,
            timestamp: Date.now()
        }));
    } catch (err) {
        logger.error('[WebSocket] label-insert Error:', err);
        // Send error back to the **requesting** client only
        sendErrorResponse(ws, 'failure', `Failed to insert new label: ${err.message || err}`);
    }
});
const labelDelete = withBasicAuth(async (ws, payload, wss) => {
    try {
        logger.info(`[WebSocket] Client ${ws._socket.remoteAddress} sent label-delete request: ${JSON.stringify(payload)}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.deleteOne(DB_ADDR, payload.body);
        await dbClient.close();

        // Broadcast result to ALL connected clients, if desired
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log(`[WebSocket] Sending label update response to client ${client._socket.remoteAddress}`);
                client.send(JSON.stringify({
                    event: 'labelUpdate',
                    success: true,
                    data: result,
                    timestamp: Date.now()
                }));
            }
        });
        // Broadcast result to the **requesting** client only
        ws.send(JSON.stringify({
            event: 'success',
            success: true,
            data: `Successfully deleted label: ${payload.body.addr}`,
            timestamp: Date.now()
        }));
    } catch (err) {
        logger.error('[WebSocket] label-delete Error:', err);
        // Send error back to the **requesting** client only
        sendErrorResponse(ws, 'failure', `Failed to delete label: ${err.message || err}`);
    }
});

wss.on('connection', (ws) => {
    logger.info(`[WebSocket] Client connected. Current clients: ${wss.clients.size}`);

    // Handle incoming messages from the client
    ws.on('message', async (rawData) => {
        let payload;

        try {
            payload = JSON.parse(rawData);
        } catch (error) {
            logger.error('[WebSocket] Invalid JSON:', error);
            sendErrorResponse(ws, 'error', 'Invalid JSON format');
            return;
        }

        if (payload.event === 'handshake') {
            // Update the last handshake time
            ws.lastHandshakeTime = Date.now();
            console.info(`[WebSocket] Received handshake from client ${ws._socket.remoteAddress}`);

            // Send a response so the client knows handshake was received
            ws.send(JSON.stringify({
                event: 'handshakeResponse',
                success: true,
                message: 'Handshake acknowledged',
                timestamp: Date.now()
            }));
        }
        else if (payload.event === 'chainGet') { await chainGet(ws, payload, wss); }
        else if (payload.event === 'entityGet') { await entityGet(ws, payload, wss); }
        else if (payload.event === 'labelGet') { await labelGet(ws, payload, wss); }
        else if (payload.event === 'labelInsert') { await labelInsert(ws, payload, wss); }
        else if (payload.event === 'labelDelete') { await labelDelete(ws, payload, wss); }
        else { sendErrorResponse(ws, 'error', `Unknown event: ${payload.event}`); }
    });

    ws.on('close', (code, reason) => {
        console.warn(`[WebSocket] Client disconnected. Code: ${code}, Reason: ${reason}`);
    });

    ws.on('error', (err) => {
        console.error('[WebSocket] Connection error:', err.message);
    });
});
/************************************/
/** Websocket Server (Legacy) Ends **/
/************************************/

server.listen(PORT, () => {
    logger.info(`Listening on ${PORT}`);
})