import { getRedisClient } from '@bemodest/database';
import logger from '../config/logger.js';

export const getStatus = async (req, res) => {
    try {
        const redis = getRedisClient();

        // Fetch scraper status
        const scraperKeys = await redis.keys('status:scraper:*');
        const scraperData = await Promise.all(scraperKeys.map(async key => {
            const data = await redis.get(key);
            try {
                return JSON.parse(data);
            } catch (e) {
                logger.error(`Failed to parse redis data for key ${key}: ${e.message}`);
                return null;
            }
        }));

        // Fetch application status
        const appKeys = await redis.keys('status:app:*');
        const appData = await Promise.all(appKeys.map(async key => {
            const data = await redis.get(key);
            try {
                return JSON.parse(data);
            } catch (e) {
                logger.error(`Failed to parse redis data for key ${key}: ${e.message}`);
                return null;
            }
        }));

        res.json({
            success: true,
            data: {
                scrapers: scraperData.filter(item => item !== null),
                apps: appData.filter(item => item !== null)
            }
        });
    } catch (error) {
        logger.error(`Error fetching status: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch status data'
        });
    }
};
