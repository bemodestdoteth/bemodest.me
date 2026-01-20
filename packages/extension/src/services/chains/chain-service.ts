import { Chains, ChainData } from './base/chains';
import { WS_EVENT_CHAIN_GET } from '../../shared/constants';

/**
 * Chain Service for managing blockchain data from MongoDB API
 * @class ChainService
 */
export class ChainService {
    private chains: Map<string, Chains> = new Map();
    private resolveChainFetch: ((value: void) => void) | null = null;
    private rejectChainFetch: ((reason?: any) => void) | null = null;

    constructor() {
        this.setupMessageListener();
    }

    /**
     * Sets up message listener for WebSocket events from background script
     * @returns {void}
     */
    private setupMessageListener(): void {
        chrome.runtime.onMessage.addListener((message: any) => {
            if (message.type === 'ws-event' && message.event === 'chainUpdate') {
                this.handleChainUpdate(message.data);
            }
        });
    }

    /**
     * Handles chain update from background script
     * @param {any} data - Chain update data
     * @returns {void}
     */
    private handleChainUpdate(data: any): void {
        if (data.success && data.data) {
            this.processChainData(data.data);
            if (this.resolveChainFetch) {
                this.resolveChainFetch();
                this.resolveChainFetch = null;
                this.rejectChainFetch = null;
            }
        } else if (this.rejectChainFetch) {
            this.rejectChainFetch(new Error('Failed to fetch chains'));
            this.resolveChainFetch = null;
            this.rejectChainFetch = null;
        }
    }

    /**
     * Fetches chains via background script WebSocket
     * @returns {Promise<void>}
     */
    async fetchChains(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.resolveChainFetch = resolve;
            this.rejectChainFetch = reject;

            const timeout = setTimeout(() => {
                if (this.rejectChainFetch) {
                    this.rejectChainFetch(new Error('Chain fetch timeout'));
                    this.resolveChainFetch = null;
                    this.rejectChainFetch = null;
                }
            }, 10000);

            chrome.runtime.sendMessage({
                action: 'ws-emit',
                event: WS_EVENT_CHAIN_GET,
                payload: { params: {}, headers: {} }
            }, (response: any) => {
                if (chrome.runtime.lastError) {
                    clearTimeout(timeout);
                    reject(new Error('Failed to request chains from background'));
                } else if (!response?.success) {
                    clearTimeout(timeout);
                    reject(new Error('WebSocket not available'));
                }
            });
        });
    }

    /**
     * Processes chain data from API response
     * @param {ChainData[]} data - Array of chain data
     * @private
     */
    private processChainData(data: ChainData[]): void {
        this.chains.clear();

        data.forEach((chainData: ChainData) => {
            const chain = new Chains(chainData);
            this.chains.set(chainData.chain.toUpperCase(), chain);
        });

        console.log(`[ChainService] Loaded ${this.chains.size} chains: ${Array.from(this.chains.keys()).join(', ')}`);
    }

    /**
     * Gets chain by code
     * @param {string} code - Chain code (e.g., 'ETH', 'BTC')
     * @returns {Chains | undefined} Chain instance or undefined
     * @example
     * ```typescript
     * const ethereum = service.getChainByCode('ETH');
     * ```
     */
    getChainByCode(code: string): Chains | undefined {
        return this.chains.get(code.toUpperCase());
    }

    /**
     * Gets chain by name
     * @param {string} name - Chain name (e.g., 'Ethereum', 'Bitcoin')
     * @returns {Chains | undefined} Chain instance or undefined
     * @example
     * ```typescript
     * const ethereum = service.getChainByName('Ethereum');
     * ```
     */
    getChainByName(name: string): Chains | undefined {
        for (const chain of this.chains.values()) {
            if (chain.name === name) {
                return chain;
            }
        }
        return undefined;
    }

    /**
     * Gets all chains
     * @returns {Chains[]} Array of all chains
     * @example
     * ```typescript
     * const allChains = service.getAllChains();
     * ```
     */
    getAllChains(): Chains[] {
        return Array.from(this.chains.values());
    }

}
