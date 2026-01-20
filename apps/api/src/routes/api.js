import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoDBClient } from '../mongoDBClient.js';
import logger from '../config/logger.js';
import {
    JWT_SECRET,
    ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH,
    COLLECTION_ADDRS,
    COLLECTION_CHAINS,
    COLLECTION_COINGECKO_RANK,
    COLLECTION_COINGECKO_LIST,
    COLLECTION_ENTITES
} from '../config/env.js';
import {
    LabelDeleteBulkSchema
} from '../schemas.js';
import {
    getCoingeckoToDuneMapping,
    enrichLabelsWithEntityImages,
    reports,
    validateSignature,
    updateClients
} from '../utils/helpers.js';
import { getIO } from '../socket/state.js';

export const walletList = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });
        await dbClient.close();

        const labelledAddresses = {};
        result.forEach(item => {
            labelledAddresses[item.addr] = {
                chain: item.chain,
                entity: item.entity,
                entityImage: item.entityImage,
                comment: item.comment,
                label: item.label,
                tracking: item.tracking
            };
        });

        res.status(200).json({ labelledAddresses });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const walletTotal = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 1 } });
        await dbClient.close();

        res.status(200).json({ walletTotal: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const walletTracking = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, { tracking: true }, { projection: { _id: 1 } });
        await dbClient.close();

        res.status(200).json({ walletTracking: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const entityTotal = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 1 } });
        await dbClient.close();

        res.status(200).json({ entityTotal: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const entityGet = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ENTITES, req.query || {}, { projection: { _id: 0 } });

        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });

        await dbClient.close();
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, message: err.message, error: err });
    }
};

export const coingeckoGet = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const rankResult = await dbClient.readMany(COLLECTION_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0 },
            }
        );
        const listResult = await dbClient.readMany(COLLECTION_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );

        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });

        const finalResult = [];
        const coingeckoToDuneMapping = await getCoingeckoToDuneMapping(dbClient);
        await dbClient.close();

        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id);

            if (Object.keys(platforms).length > 0) {
                for (const [key, value] of Object.entries(platforms)) {
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
};

export const coingeckoGetSolana = async (req, res) => {
    try {
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const rankResult = await dbClient.readMany(COLLECTION_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0 },
            }
        );
        const listResult = await dbClient.readMany(COLLECTION_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );

        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });

        const finalResult = [];
        const coingeckoToDuneMapping = await getCoingeckoToDuneMapping(dbClient);
        await dbClient.close();
        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id);

            if (Object.keys(platforms).length > 0) {
                for (const [key, value] of Object.entries(platforms)) {
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
};

export const removeFront = async (req, res) => {
    try {
        const validated = LabelDeleteBulkSchema.parse(req.body);
        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const addresses = Array.isArray(validated.address) ? validated.address : [validated.address];

        await dbClient.deleteMany(COLLECTION_ADDRS, { addr: { $in: addresses } });

        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });
        await enrichLabelsWithEntityImages(result, dbClient);
        await dbClient.close();

        const io = getIO();
        if (io) {
            io.emit('labelUpdate', {
                success: true,
                data: result,
                timestamp: Date.now()
            });
        }

        res.status(200).json({ success: true, message: `Deleted ${addresses.length} addresses` });

    } catch (err) {
        logger.error(`removeFront Error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DELETE_ERROR',
                message: err.message || 'Failed to delete labels'
            }
        });
    }
};

export const getExchSnapperReport = async (req, res) => {
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

    if (!reports[from]) {
        reports[from] = [];
    }

    reports[from].push({ timestamp: time, status });
    res.json({ success: true });
    updateClients();
};

export const login = async (req, res) => {
    try {
        let username, password;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
            [username, password] = credentials.split(':');
        } else if (req.body.username && req.body.password) {
            username = req.body.username;
            password = req.body.password;
        } else {
            return res.status(401).json({ success: false, message: 'Missing credentials' });
        }

        if (username !== ADMIN_USERNAME) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const webToken = jwt.sign(
            { userId: username, type: 'web' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('auth-token', webToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.status(200).json({
            success: true,
            data: { token: webToken }
        });

    } catch (err) {
        logger.error(`Login error: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const logout = (req, res) => {
    res.clearCookie('auth-token');
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};

export const checkSession = (req, res) => {
    const token = req.cookies['auth-token'];

    if (!token) {
        return res.status(200).json({ authenticated: false });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return res.status(200).json({
            authenticated: true,
            userId: decoded.userId
        });
    } catch (err) {
        return res.status(200).json({ authenticated: false });
    }
};

export const getExtensionToken = (req, res) => {
    const webToken = req.cookies['auth-token'];

    if (!webToken) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    try {
        const decoded = jwt.verify(webToken, JWT_SECRET);

        const extensionToken = jwt.sign(
            { userId: decoded.userId, type: 'extension' },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            success: true,
            data: { token: extensionToken }
        });
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};

export const labelDelete = (req, res) => {
    // Placeholder for missing REST handler
    logger.warn('labelDelete REST API called - implementation is missing');
    res.status(501).json({ success: false, message: 'Not implemented' });
};
