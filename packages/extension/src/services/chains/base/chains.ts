/**
 * Base Chain class representing blockchain configuration
 * @category Base
 */
export interface ChainData {
    _id?: string;
    name: string;
    symbol: string;
    isTestnet: boolean;
    gasPriceGwei: number | null;
    rpc: string[];
    wsRpc: string[];
    blockExplorerPrefix: string;
    bgColor: string;
    fontColor: string;
    addrRegexPatterns?: string[];
    addrCaseSensitive: boolean;
    memoRequired?: boolean;
    memoRegexPatterns?: string[];
    block_time?: number;
    annotation?: Record<string, any>;
    caip2: string;
}

/**
 * Base Chains class for all blockchain types
 * @class Chains
 * @example
 * ```typescript
 * const chain = new Chains(chainData);
 * console.log(chain.name); // "Ethereum"
 * ```
 */
export class Chains {
    _id?: string;
    name: string;
    symbol: string;
    isTestnet: boolean;
    gasPriceGwei: number | null;
    rpc: string[];
    wsRpc: string[];
    blockExplorerPrefix: string;
    bgColor: string;
    fontColor: string;
    addrRegexPatterns: RegExp[];
    addrCaseSensitive: boolean;
    memoRequired: boolean;
    memoRegexPatterns: string[];
    block_time: number;
    annotation?: Record<string, any>;
    caip2: string;

    /**
     * Creates a new Chains instance
     * @param {ChainData} data - Chain configuration data
     */
    constructor(data: ChainData) {
        this._id = data._id;
        this.name = data.name;
        this.symbol = data.symbol;
        this.isTestnet = data.isTestnet;
        this.gasPriceGwei = data.gasPriceGwei;
        this.rpc = data.rpc || [];
        this.wsRpc = data.wsRpc || [];
        this.blockExplorerPrefix = data.blockExplorerPrefix;
        this.bgColor = data.bgColor;
        this.fontColor = data.fontColor;
        this.addrRegexPatterns = this.parseRegexPatterns(data.addrRegexPatterns);
        this.addrCaseSensitive = data.addrCaseSensitive;
        this.memoRequired = data.memoRequired || false;
        this.memoRegexPatterns = data.memoRegexPatterns || [];
        this.block_time = data.block_time ?? 30;
        this.annotation = data.annotation;
        this.caip2 = data.caip2;
    }

    /**
     * Parses regex pattern strings into RegExp objects
     * @param {string[]} patterns - Array of regex pattern strings
     * @returns {RegExp[]} Array of RegExp objects
     * @private
     */
    private parseRegexPatterns(patterns?: string[]): RegExp[] {
        if (!patterns || patterns.length === 0) {
            console.warn(`[Chains] No regex patterns found for chain: ${this.name}`);
            return [];
        }
        return patterns.map((pattern: string) => {
            const match = pattern.match(/^\/(.*)\/([gimsuy]*)$/);
            if (match) {
                return new RegExp(match[1], match[2]);
            }
            return new RegExp(pattern);
        });
    }

    /**
     * Converts instance to JSON representation
     * @returns {ChainData} JSON representation
     */
    toJSON(): ChainData {
        return {
            _id: this._id,
            name: this.name,
            symbol: this.symbol,
            isTestnet: this.isTestnet,
            gasPriceGwei: this.gasPriceGwei,
            rpc: this.rpc,
            wsRpc: this.wsRpc,
            blockExplorerPrefix: this.blockExplorerPrefix,
            bgColor: this.bgColor,
            fontColor: this.fontColor,
            addrRegexPatterns: this.addrRegexPatterns.map(r => r.toString()),
            addrCaseSensitive: this.addrCaseSensitive,
            memoRequired: this.memoRequired,
            memoRegexPatterns: this.memoRegexPatterns,
            block_time: this.block_time,
            annotation: this.annotation,
            caip2: this.caip2,
        };
    }

    /**
     * Converts instance to string representation
     * @returns {string} String representation
     */
    toString(): string {
        return `${this.name} (${this.symbol})`;
    }
}
