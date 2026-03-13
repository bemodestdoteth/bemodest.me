import path from 'path';
import fs from 'node:fs/promises';
import { MongoDBClient } from '@bemodest/database';
import { ObjectId } from 'mongodb';
import logger from '../config/logger.js';
import {
    COLLECTION_ADDRS,
    COLLECTION_CHAINS,
    COLLECTION_ENTITES,
    IMAGE_SIZE_LIMIT_BYTES
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
    LabelUpdateSchema,
    ChainInsertSchema,
    ChainUpdateSchema,
    ChainDeleteSchema
} from '@bemodest/database';
import { enrichLabelsWithEntityImages, getChainsWithCounts, compileChainRegexes } from '../utils/helpers.js';
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

        if (chain.caip2) {
            const caipParts = chain.caip2.split(':');
            if (caipParts[0] === 'eip155' && caipParts[1]) {
                try {
                    const response = await fetch('https://chainid.network/chains.json');
                    if (!response.ok) throw new Error('Failed to fetch EVM registry');
                    const chainsList = await response.json();
                    const chainIdNum = parseInt(caipParts[1], 10);
                    const isValidEVM = chainsList.some(c => c.chainId === chainIdNum);
                    if (!isValidEVM) {
                        await dbClient.close();
                        socket.emit('failure', {
                            success: false,
                            error: { code: 'VALIDATION_ERROR', message: `EVM Chain ID ${chainIdNum} is not registered on chainid.network.` }
                        });
                        return;
                    }
                } catch (fetchErr) {
                    logger.warn(`Could not verify EVM chain against registry: ${fetchErr.message}`);
                }
            }
        }

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

        // Use ObjectId if valid, else fallback
        const targetId = ObjectId.isValid(_id) ? new ObjectId(_id) : (isNaN(Number(_id)) ? _id : Number(_id));

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
        const chainToDelete = await dbClient.readMany(COLLECTION_CHAINS, { name: validated.body.name }, { projection: { caip2: 1 } });
        if (chainToDelete.length === 0) {
            await dbClient.close();
            throw new Error('Chain not found');
        }

        const caip2Id = chainToDelete[0].caip2;

        if (caip2Id && caip2Id.startsWith('cosmos:')) {
            await dbClient.close();
            socket.emit('failure', {
                success: false,
                error: {
                    code: 'DELETION_BLOCKED',
                    message: "Cosmos chains cannot be deleted. Please update the chain to set status: 'deprecated' and provide a supersededBy CAIP-2 ID."
                }
            });
            return;
        }

        const labelCount = await dbClient.count(COLLECTION_ADDRS, { chains: caip2Id });

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
        const IMAGE_SIZE_LIMIT = IMAGE_SIZE_LIMIT_BYTES;

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

        const IMAGE_SIZE_LIMIT = IMAGE_SIZE_LIMIT_BYTES;
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

        // Gather all unique chains involved (primary chains + alias chains)
        const allChains = new Set([...validated.body.chains]);
        if (validated.body.aliases) {
            validated.body.aliases.forEach(a => allChains.add(a.chain));
        }

        const chainDocs = await dbClient.readMany(COLLECTION_CHAINS, {
            caip2: { $in: Array.from(allChains) }
        });

        // Validate primary chains exist
        const primaryChainsExist = validated.body.chains.every(c => chainDocs.some(cd => cd.caip2 === c));
        if (!primaryChainsExist) {
            await dbClient.close();
            socket.emit('failure', { success: false, error: { code: 'INVALID_CHAIN', message: 'One or more primary chain codes are invalid.' } });
            return;
        }

        const { chainRegexMap, regexFingerprintMap } = compileChainRegexes(chainDocs);

        // Alias validation: check if alias chain exists and validate alias name against regex
        if (validated.body.aliases) {
            for (const alias of validated.body.aliases) {
                if (!chainRegexMap[alias.chain]) {
                    await dbClient.close();
                    socket.emit('failure', { success: false, error: { code: 'INVALID_ALIAS_CHAIN', message: `Chain '${alias.chain}' for alias '${alias.name}' not found or has no regex.` } });
                    return;
                }
                const isValidAlias = chainRegexMap[alias.chain].some(regex => regex.test(alias.name));
                if (!isValidAlias) {
                    await dbClient.close();
                    socket.emit('failure', { success: false, error: { code: 'INVALID_ALIAS_FORMAT', message: `Alias '${alias.name}' does not match the required address format for ${alias.chain}.` } });
                    return;
                }
            }
        }

        const primaryFingerprints = validated.body.chains.map(c => regexFingerprintMap[c]);
        if (!primaryFingerprints.every(fp => fp === primaryFingerprints[0])) {
            await dbClient.close();
            socket.emit('failure', { success: false, error: { code: 'INCOMPATIBLE_CHAINS', message: 'All selected chains must share the same address format (regex). You cannot combine EVM chains with Solana, for example.' } });
            return;
        }

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

/**
 * Handle labelUpdate event - updates existing label
 * @param {object} socket - Socket.IO socket instance
 * @param {object} payload - Update request payload
 * @returns {Promise<void>}
 */
export async function handleLabelUpdate(socket, payload) {
    try {
        logger.info(`[Socket.IO] handleLabelUpdate entry - payload: ${JSON.stringify(payload)}`);
        
        let validated;
        try {
            validated = LabelUpdateSchema.parse(payload);
            logger.info(`[Socket.IO] Payload validated successfully for ${validated.body.originalAddr}`);
        } catch (zodErr) {
            logger.error(`[Socket.IO] Validation failed for labelUpdate: ${JSON.stringify(zodErr.errors)}`);
            socket.emit('failure', {
                success: false,
                error: { code: 'VALIDATION_ERROR', message: zodErr.errors.map(e => e.message).join(', ') }
            });
            return;
        }

        const dbClient = new MongoDBClient();
        await dbClient.connect();
        logger.info(`[Socket.IO] DB connected for update to ${validated.body.originalAddr}`);

        const { originalAddr, ...updateData } = validated.body;

        // Verify label exists
        const existingLabel = await dbClient.readMany(COLLECTION_ADDRS, { addr: originalAddr }, { projection: { _id: 1 } });
        if (existingLabel.length === 0) {
            logger.warn(`[Socket.IO] Label not found for update: ${originalAddr}`);
            await dbClient.close();
            socket.emit('failure', {
                success: false,
                error: { code: 'NOT_FOUND', message: `Label for address ${originalAddr} not found.` }
            });
            return;
        }

        // If renaming address, check if new address exists
        if (originalAddr !== updateData.addr) {
            const conflict = await dbClient.readMany(COLLECTION_ADDRS, { addr: updateData.addr }, { projection: { _id: 1 } });
            if (conflict.length > 0) {
                logger.warn(`[Socket.IO] Label update conflict: New address ${updateData.addr} already exists`);
                await dbClient.close();
                socket.emit('failure', {
                    success: false,
                    error: { code: 'CONFLICT', message: `Label for address "${updateData.addr}" already exists` }
                });
                return;
            }
        }

        // Gather all unique chains involved (primary chains + alias chains)
        const allChains = new Set([...updateData.chains]);
        if (updateData.aliases) {
            updateData.aliases.forEach(a => allChains.add(a.chain));
        }

        const chainDocs = await dbClient.readMany(COLLECTION_CHAINS, {
            caip2: { $in: Array.from(allChains) }
        });

        // Validate primary chains exist
        const primaryChainsExist = updateData.chains.every(c => chainDocs.some(cd => cd.caip2 === c));
        if (!primaryChainsExist) {
            await dbClient.close();
            socket.emit('failure', { success: false, error: { code: 'INVALID_CHAIN', message: 'One or more primary chain codes are invalid.' } });
            return;
        }

        const { chainRegexMap, regexFingerprintMap } = compileChainRegexes(chainDocs);

        // Alias validation: check if alias chain exists and validate alias name against regex
        if (updateData.aliases) {
            for (const alias of updateData.aliases) {
                if (!chainRegexMap[alias.chain]) {
                    await dbClient.close();
                    socket.emit('failure', { success: false, error: { code: 'INVALID_ALIAS_CHAIN', message: `Chain '${alias.chain}' for alias '${alias.name}' not found or has no regex.` } });
                    return;
                }
                const isValidAlias = chainRegexMap[alias.chain].some(regex => regex.test(alias.name));
                if (!isValidAlias) {
                    await dbClient.close();
                    socket.emit('failure', { success: false, error: { code: 'INVALID_ALIAS_FORMAT', message: `Alias '${alias.name}' does not match the required address format for ${alias.chain}.` } });
                    return;
                }
            }
        }

        // Validate that the provided address is valid for EVERY selected chain
        const invalidChains = updateData.chains.filter(c => {
            const patterns = chainRegexMap[c];
            if (!patterns) return true;
            return !patterns.some(re => {
                // Reset regex state for global/sticky regexes
                re.lastIndex = 0;
                return re.test(updateData.addr);
            });
        });
        
        if (invalidChains.length > 0) {
            logger.warn(`[Socket.IO] Incompatible chains for update: ${updateData.chains.join(', ')} - Address ${updateData.addr} is invalid for: ${invalidChains.join(', ')}`);
            await dbClient.close();
            socket.emit('failure', { 
                success: false, 
                error: { 
                    code: 'INCOMPATIBLE_CHAINS', 
                    message: `The address "${updateData.addr}" is not valid for the following selected chains: ${invalidChains.join(', ')}. Please ensure all selected chains share the same address format.` 
                } 
            });
            return;
        }
        
        logger.info(`[Socket.IO] Chains compatible (address validated for all ${updateData.chains.length} chains)`);

        const updateResult = await dbClient.updateOne(COLLECTION_ADDRS, { addr: originalAddr }, { $set: updateData });

        if (updateResult.matchedCount === 0) {
            logger.error(`[Socket.IO] labelUpdate failed: No document matched for addr ${originalAddr}`);
            await dbClient.close();
            socket.emit('failure', {
                success: false,
                error: { code: 'UPDATE_FAILED', message: 'Failed to update label: Document not found during update operation.' }
            });
            return;
        }

        logger.info(`[Socket.IO] successfully updated label for ${originalAddr} (modified: ${updateResult.modifiedCount})`);

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
            data: `Successfully updated label: ${updateData.addr}`,
            timestamp: Date.now()
        });

    } catch (err) {
        logger.error('[Socket.IO] labelUpdate Error:', err);
        socket.emit('failure', {
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'UPDATE_ERROR',
                message: err.message || 'Failed to update label'
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
                chains: item.chains ?? [],
                entity: item.entity,
                entityImage: item.entityImage,
                comment: item.comment,
                label: item.label,
                tracking: item.tracking,
                aliases: item.aliases ?? []
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
            projection: { caip2: 1, addrRegexPatterns: 1, addrCaseSensitive: 1, _id: 0 }
        });

        const { chainRegexMap, regexFingerprintMap } = compileChainRegexes(chains);

        const labels = validated.body;
        const results = [];
        let successCount = 0;
        const DUPLICATE_ERROR_CODE = 11000;

        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            try {
                // Validate all chain codes in label.chains exist
                const missingChain = label.chains.find(code => !chainRegexMap[code]);
                if (missingChain) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: `Chain '${missingChain}' not found or has no address patterns`
                    });
                    continue;
                }

                // Validate all chains share the same addrRegexPatterns
                const fingerprints = label.chains.map(code => regexFingerprintMap[code]);
                if (!fingerprints.every(fp => fp === fingerprints[0])) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: 'All chains in a label must share the same address format (regex)'
                    });
                    continue;
                }

                // Validate address against first chain's regex (all share same patterns)
                const primaryRegexArray = chainRegexMap[label.chains[0]];
                const isValidAddress = primaryRegexArray.some(regex => regex.test(label.addr));
                if (!isValidAddress) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: `Invalid address format for chain(s) ${label.chains.join(', ')}`
                    });
                    continue;
                }

                // Validate aliases (if any)
                let aliasError = null;
                if (label.aliases) {
                    for (const alias of label.aliases) {
                        if (!chainRegexMap[alias.chain]) {
                            aliasError = `Chain '${alias.chain}' for alias '${alias.name}' not found or has no regex`;
                            break;
                        }
                        const isValidAlias = chainRegexMap[alias.chain].some(regex => regex.test(alias.name));
                        if (!isValidAlias) {
                            aliasError = `Alias '${alias.name}' does not match the required address format for ${alias.chain}`;
                            break;
                        }
                    }
                }

                if (aliasError) {
                    results.push({
                        index: i,
                        success: false,
                        addr: label.addr,
                        error: aliasError
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
