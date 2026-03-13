import { createLogger } from '@bemodest/utils';
import { LOG_LEVEL, LOG_FILE } from './env.js';
import path from 'node:path';

const logDir = path.dirname(LOG_FILE || './logs/api.log');

const logger = createLogger(logDir, LOG_LEVEL);

export default logger;


