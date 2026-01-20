import { Chains, ChainData } from './base/chains';
import { ChainService } from './chain-service';

/**
 * Global Chain Manager singleton
 * Provides global access to chain data similar to the old chains.ts
 * @class ChainManager
 * @example
 * ```typescript
 * const manager = ChainManager.getInstance();
 * await manager.initialize();
 * const ethereum = manager.createInstance('Ethereum');
 * ```
 */
export class ChainManager {
    private static instance: ChainManager;
    private chainService: ChainService;
    private initialized: boolean = false;

    private constructor() {
        this.chainService = new ChainService();
    }

    /**
     * Gets singleton instance
     * @returns {ChainManager} Singleton instance
     */
    static getInstance(): ChainManager {
        if (!ChainManager.instance) {
            ChainManager.instance = new ChainManager();
        }
        return ChainManager.instance;
    }

    /**
     * Initializes chain manager by fetching from MongoDB
     * @returns {Promise<void>}
     * @throws {Error} Initialization failed
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.chainService.fetchChains();
            this.initialized = true;
            console.log('[ChainManager] Initialized successfully');
        } catch (error) {
            console.error('[ChainManager] Initialization failed:', error);
            throw error;
        }
    }


    /**
     * Gets all chains
     * @returns {Chains[]} Array of all chains
     */
    getAllChains(): Chains[] {
        return this.chainService.getAllChains();
    }

    /**
     * Gets chain by code
     * @param {string} code - Chain code (e.g., 'ETH', 'BTC')
     * @returns {Chains | undefined} Chain instance or undefined
     */
    getChainByCode(code: string): Chains | undefined {
        return this.chainService.getChainByCode(code);
    }

    /**
     * Gets chain by name
     * @param {string} name - Chain name
     * @returns {Chains | undefined} Chain instance or undefined
     */
    getChainByName(name: string): Chains | undefined {
        return this.chainService.getChainByName(name);
    }
}

declare global {
    interface Window {
        chainManager: ChainManager;
    }
}

export async function initializeGlobalChainManager(): Promise<void> {
    const manager = ChainManager.getInstance();
    await manager.initialize();
    window.chainManager = manager;
}
