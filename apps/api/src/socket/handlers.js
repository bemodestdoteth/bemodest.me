import path from 'path';
import fs from 'node:fs/promises';
import { MongoDBClient } from '../mongoDBClient.js';
import logger from '../config/logger.js';
import {
    COLLECTION_ADDRS,
    COLLECTION_CHAINS,
    COLLECTION_ENTITES
} from '../config/env.js';
import {
    ChainGetSchema,
    EntityGetSchema,
    EntityInsertSchema,
    EntityDeleteSchema,
    EntityUpdateSchema,
    LabelGetSchema,
    LabelInsertSchema,
    LabelDeleteSchema,
    LabelInsertBulkSchema,
    ChainInsertSchema,
    ChainUpdateSchema,
    ChainDeleteSchema
} from '../schemas.js';
import { enrichLabelsWithEntityImages, getChainsWithCounts } from '../utils/helpers.js';
import { getIO } from './state.js';

export async function handleChainGet(socket, payload) {
    try {
        const validated = ChainGetSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent chainGet request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const result = await getChainsWithCounts(dbClient, validated.params);

        await dbClient.close();

        const io = getIO();
        io.emit('chainUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] chainGet Error:', err);
        socket.emit('get_error', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DATABASE_ERROR',
                message: err.message || 'Failed to fetch chains'
            }
        });
    }
}

export async function handleChainInsert(socket, payload) {
    try {
        const validated = ChainInsertSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent chainInsert request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const chain = validated.body;

        // Find max numeric _id for incremental ID
        const count = await dbClient.readMany(COLLECTION_CHAINS, {}, { projection: { _id: 1 } });
        let newId = 0;
        if (count.length > 0) {
            const maxId = count.reduce((max, doc) => {
                const id = parseInt(doc._id);
                return !isNaN(id) && id > max ? id : max;
            }, -1);
            newId = maxId + 1;
        }

        chain._id = newId;

        await dbClient.createOne(COLLECTION_CHAINS, chain);

        const result = await getChainsWithCounts(dbClient, {});
        await dbClient.close();

        const io = getIO();
        io.emit('chainUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully inserted new chain: ${chain.name}`,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] chainInsert Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'INSERT_ERROR',
                message: err.message || 'Failed to insert chain'
            }
        });
    }
}

/**
 * Handle chainUpdate event - updates existing chain
 * @param {object} socket - Socket.IO socket instance
 * @param {object} payload - Update request payload with chain data
 * @returns {Promise<void>}
 * @throws {Error} On validation or database errors
 */
export async function handleChainUpdate(socket, payload) {
    try {
        const validated = ChainUpdateSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent chainUpdate request for ID ${validated.body._id}`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const { _id, ...updateData } = validated.body;

        // Parse _id as number if possible (as stored in handleChainInsert)
        const targetId = isNaN(Number(_id)) ? _id : Number(_id);

        await dbClient.updateOne(COLLECTION_CHAINS, { _id: targetId }, { $set: updateData });

        const result = await getChainsWithCounts(dbClient, {});
        await dbClient.close();

        const io = getIO();
        io.emit('chainUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully updated chain: ${updateData.name}`,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] chainUpdate Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'UPDATE_ERROR',
                message: err.message || 'Failed to update chain'
            }
        });
    }
}

export async function handleChainDelete(socket, payload) {
    try {
        const validated = ChainDeleteSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent chainDelete request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        // Check if chain has labels before deletion
        const chainToDelete = await dbClient.readMany(COLLECTION_CHAINS, { name: validated.body.name }, { projection: { chain: 1, code: 1 } });
        if (chainToDelete.length === 0) {
            await dbClient.close();
            throw new Error('Chain not found');
        }

        const chainCode = chainToDelete[0].chain || chainToDelete[0].code;
        const labelCount = await dbClient.count(COLLECTION_ADDRS, { chain: chainCode });

        if (labelCount > 0) {
            await dbClient.close();
            socket.emit('failure', {
                success: false,
                error: {
                    code: 'CHAIN_IN_USE',
                    message: `Cannot delete chain. ${labelCount} label(s) are using this chain.`
                }
            });
            return;
        }

        await dbClient.deleteOne(COLLECTION_CHAINS, { name: validated.body.name });

        const result = await getChainsWithCounts(dbClient, {});
        await dbClient.close();

        const io = getIO();
        io.emit('chainUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully deleted chain: ${validated.body.name}`,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] chainDelete Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DELETE_ERROR',
                message: err.message || 'Failed to delete chain'
            }
        });
    }
}

export async function handleEntityGet(socket, payload) {
    try {
        const validated = EntityGetSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent entityGet request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ENTITES, validated.params, { projection: { _id: 0 } });

        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });
        await dbClient.close();

        const io = getIO();
        io.emit('entityUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] entityGet Error:', err);
        socket.emit('get_error', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DATABASE_ERROR',
                message: err.message || 'Failed to fetch entities'
            }
        });
    }
}

export async function handleEntityInsert(socket, payload) {
    try {
        const validated = EntityInsertSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent entityInsert request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const entries = Object.entries(validated.body);
        const IMAGE_SIZE_LIMIT = 1048576;

        for (const [name, data] of entries) {
            const entity = {
                name: name,
                image: data.image || '',
                comment: data.comment || '',
                tracking: data.tracking || false
            };

            if (entity.image && entity.image.length > IMAGE_SIZE_LIMIT * 1.37) {
                throw new Error(`Image size for ${entity.name} exceeds 1MB limit`);
            }

            if (entity.image && data.imageFilename) {
                try {
                    const imageBuffer = Buffer.from(entity.image, 'base64');
                    const imagesDir = path.join(process.cwd(), 'public', 'images');
                    await fs.mkdir(imagesDir, { recursive: true });
                    const imagePath = path.join(imagesDir, data.imageFilename);
                    await fs.writeFile(imagePath, imageBuffer);
                    logger.info(`[Socket.IO] Saved image for entity ${entity.name} to ${imagePath}`);
                } catch (writeErr) {
                    logger.error(`[Socket.IO] Failed to save image to disk: ${writeErr.message}`);
                }
            }

            await dbClient.createOne(COLLECTION_ENTITES, entity);
            socket.emit('success', {
                success: true,
                data: `Successfully inserted new entity: ${entity.name}`,
                timestamp: Date.now()
            });
        }

        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 0 } });
        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });
        await dbClient.close();

        const io = getIO();
        io.emit('entityUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] entityInsert Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'INSERT_ERROR',
                message: err.message || 'Failed to insert entity'
            }
        });
    }
}

export async function handleEntityDelete(socket, payload) {
    try {
        const validated = EntityDeleteSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent entityDelete request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const query = { name: validated.body.name };
        await dbClient.deleteOne(COLLECTION_ENTITES, query);

        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 0 } });
        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });
        await dbClient.close();

        const io = getIO();
        io.emit('entityUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully deleted entity: ${validated.body.name}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] entityDelete Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DELETE_ERROR',
                message: err.message || 'Failed to delete entity'
            }
        });
    }
}

/**
 * Handle entityUpdate event - updates existing entity
 * @param {object} socket - Socket.IO socket instance
 * @param {object} payload - Update request payload
 * @returns {Promise<void>}
 */
export async function handleEntityUpdate(socket, payload) {
    try {
        const validated = EntityUpdateSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent entityUpdate request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const { originalName, name, image, imageFilename, comment, tracking } = validated.body;

        // Verify entity exists
        const existingEntity = await dbClient.readMany(COLLECTION_ENTITES, { name: originalName }, { projection: { _id: 1 } });
        if (existingEntity.length === 0) {
            await dbClient.close();
            throw new Error('Entity not found');
        }

        // Prepare update data
        const updateData = {
            name,
            comment,
            tracking
        };

        const IMAGE_SIZE_LIMIT = 1048576;
        if (image) {
            if (image.length > IMAGE_SIZE_LIMIT * 1.37) {
                throw new Error(`Image size for ${name} exceeds 1MB limit`);
            }
            updateData.image = image;

            if (imageFilename) {
                try {
                    const imageBuffer = Buffer.from(image, 'base64');
                    const imagesDir = path.join(process.cwd(), 'public', 'images');
                    await fs.mkdir(imagesDir, { recursive: true });
                    const imagePath = path.join(imagesDir, imageFilename);
                    await fs.writeFile(imagePath, imageBuffer);
                    logger.info(`[Socket.IO] Saved image for entity ${name} to ${imagePath}`);
                } catch (writeErr) {
                    logger.error(`[Socket.IO] Failed to save image to disk: ${writeErr.message}`);
                }
            }
        }

        // If renaming, we need to handle it carefully because 'name' is the key
        if (originalName !== name) {
            // Check if new name exists
            const conflict = await dbClient.readMany(COLLECTION_ENTITES, { name: name }, { projection: { _id: 1 } });
            if (conflict.length > 0) {
                await dbClient.close();
                throw new Error(`Entity with name "${name}" already exists`);
            }
            // Renaming = creating new + deleting old in some DB designs, but Mongo updateOne with $set is fine if not checking key constraints that prohibit updates
            // Wait, MongoDB collection key is _id, but we are using 'name' effectively as key in the extension map.
            // If we change 'name' field, that's fine as long as _id is unique.
            // However, the extension code uses name as key.
        }

        await dbClient.updateOne(COLLECTION_ENTITES, { name: originalName }, { $set: updateData });


        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 0 } });
        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });
        await dbClient.close();

        const io = getIO();
        io.emit('entityUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully updated entity: ${name}`,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] entityUpdate Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'UPDATE_ERROR',
                message: err.message || 'Failed to update entity'
            }
        });
    }
}

export async function handleLabelGet(socket, payload) {
    try {
        const validated = LabelGetSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent labelGet request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, validated.params, { projection: { _id: 0 } });
        await enrichLabelsWithEntityImages(result, dbClient);
        await dbClient.close();

        const io = getIO();
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelGet Error:', err);
        socket.emit('get_error', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DATABASE_ERROR',
                message: err.message || 'Failed to fetch labels'
            }
        });
    }
}

export async function handleLabelInsert(socket, payload) {
    try {
        const validated = LabelInsertSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent labelInsert request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        await dbClient.createOne(COLLECTION_ADDRS, validated.body);
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });
        await enrichLabelsWithEntityImages(result, dbClient);
        await dbClient.close();

        const io = getIO();
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully inserted new label: ${validated.body.addr}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelInsert Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'INSERT_ERROR',
                message: err.message || 'Failed to insert new label'
            }
        });
    }
}

export async function handleLabelDelete(socket, payload) {
    try {
        const validated = LabelDeleteSchema.parse(payload);
        logger.info(`[Socket.IO] Client ${socket.id} sent labelDelete request`);

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        await dbClient.deleteOne(COLLECTION_ADDRS, validated.body);
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });
        await enrichLabelsWithEntityImages(result, dbClient);
        await dbClient.close();

        const io = getIO();
        io.emit('labelUpdate', {
            success: true,
            data: result,
            timestamp: Date.now()
        });

        socket.emit('success', {
            success: true,
            data: `Successfully deleted label: ${validated.body.addr}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] labelDelete Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DELETE_ERROR',
                message: err.message || 'Failed to delete label'
            }
        });
    }
}

export async function handleWalletTrackingGet(socket) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent walletTrackingGet request`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, { tracking: true }, { projection: { _id: 1 } });
        await dbClient.close();

        socket.emit('walletTrackingUpdate', {
            success: true,
            data: { walletTracking: result.length },
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] walletTrackingGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch wallet tracking count: ${err.message || err}` });
    }
}

export async function handleWalletTotalGet(socket) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent walletTotalGet request`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 1 } });
        await dbClient.close();

        socket.emit('walletTotalUpdate', {
            success: true,
            data: { walletTotal: result.length },
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] walletTotalGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch wallet total: ${err.message || err}` });
    }
}

export async function handleWalletsGet(socket) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent walletsGet request`);
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

        socket.emit('walletsUpdate', {
            success: true,
            data: { labelledAddresses },
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] walletsGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch wallets: ${err.message || err}` });
    }
}

export async function handleEntityTotalGet(socket) {
    try {
        logger.info(`[Socket.IO] Client ${socket.id} sent entityTotalGet request`);
        const dbClient = new MongoDBClient();
        await dbClient.connect();
        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 1 } });
        await dbClient.close();

        socket.emit('entityTotalUpdate', {
            success: true,
            data: { entityTotal: result.length },
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error('[Socket.IO] entityTotalGet Error:', err);
        socket.emit('get_error', { error: `Failed to fetch entity total: ${err.message || err}` });
    }
}

export async function handleLabelInsertBulk(socket, payload) {
    try {
        const bodyLength = payload.body ? payload.body.length : 'unknown';
        logger.info(`[Socket.IO] Client ${socket.id} sent labelInsertBulk request with ${bodyLength} items`);

        const validated = LabelInsertBulkSchema.parse(payload);

        const dbClient = new MongoDBClient();
        await dbClient.connect();

        const chains = await dbClient.readMany(COLLECTION_CHAINS, {}, {
            projection: { chain: 1, addrRegexPatterns: 1, addrCaseSensitive: 1, _id: 0 }
        });
        const chainRegexMap = {};
        chains.forEach(chainDoc => {
            if (chainDoc.chain && chainDoc.addrRegexPatterns && chainDoc.addrRegexPatterns.length > 0) {
                const baseFlags = chainDoc.addrCaseSensitive === false ? 'i' : '';
                chainRegexMap[chainDoc.chain] = chainDoc.addrRegexPatterns.map(patternStr => {
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
                        logger.error(`Invalid regex pattern for ${chainDoc.chain}: ${patternStr}`);
                        return null;
                    }
                }).filter(r => r !== null);
            }
        });

        const labels = validated.body;
        const results = [];
        let successCount = 0;
        const DUPLICATE_ERROR_CODE = 11000;

        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            try {
                const regexArray = chainRegexMap[label.chain];
                if (!regexArray || regexArray.length === 0) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: `Chain ${label.chain} not found or has no address patterns`
                    });
                    continue;
                }

                const isValidAddress = regexArray.some(regex => regex.test(label.addr));
                if (!isValidAddress) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: `Invalid address format for chain ${label.chain}`
                    });
                    continue;
                }

                await dbClient.createOne(COLLECTION_ADDRS, label);
                results.push({ index: i, success: true, addr: label.addr });
                successCount++;
            } catch (itemErr) {
                logger.warn(`Bulk insert item error at index ${i}: ${itemErr.message}`);
                const isDuplicate = itemErr.code === DUPLICATE_ERROR_CODE;
                results.push({
                    index: i,
                    success: false,
                    addr: label.addr,
                    error: isDuplicate ? 'Address already exists' : itemErr.message
                });
            }
        }

        const allSucceeded = successCount === labels.length;
        socket.emit('bulkInsertResult', {
            success: allSucceeded,
            results: results,
            timestamp: Date.now()
        });

        if (successCount > 0) {
            const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });
            await enrichLabelsWithEntityImages(result, dbClient);

            const io = getIO();
            io.emit('labelUpdate', {
                success: true,
                data: result,
                timestamp: Date.now()
            });
        }

        await dbClient.close();

    } catch (err) {
        logger.error('[Socket.IO] labelInsertBulk Error:', err);
        socket.emit('bulkInsertResult', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'BULK_INSERT_ERROR',
                message: err.message || 'Failed to process bulk insert'
            }
        });
    }
}
