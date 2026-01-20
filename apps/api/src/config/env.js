import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });

export const PORT = process.env.PORT;
export const JWT_SECRET = process.env.JWT_SECRET;
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
export const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
export const COLLECTION_ADDRS = process.env.COLLECTION_ADDRS;
export const COLLECTION_CHAINS = process.env.COLLECTION_CHAINS;
export const COLLECTION_COINGECKO_RANK = process.env.COLLECTION_COINGECKO_RANK;
export const COLLECTION_COINGECKO_LIST = process.env.COLLECTION_COINGECKO_LIST;
export const COLLECTION_ENTITES = process.env.COLLECTION_ENTITES;
export const CHROME_EXTENSION_ID = process.env.CHROME_EXTENSION_ID;

export { envFile };
