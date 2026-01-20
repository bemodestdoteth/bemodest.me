/**
 * Base Chain class representing blockchain configuration
 * @category Base
 */
export interface ChainData {
    name: string;
    chain: string;
    blockExplorerPrefix: string;
    blockExplorerPostfix: string;
    blockExplorerHasIframe: boolean;
    bgColor: string;
    fontColor: string;
    addrRegexPatterns?: string[];
    addrCaseSensitive: boolean;
    annotation?: Record<string, any>;
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
    name: string;
    chain: string;
    blockExplorerPrefix: string;
    blockExplorerPostfix: string;
    blockExplorerHasIframe: boolean;
    bgColor: string;
    fontColor: string;
    addrRegexPatterns: RegExp[];
    addrCaseSensitive: boolean;
    annotation?: Record<string, any>;

    /**
     * Creates a new Chains instance
     * @param {ChainData} data - Chain configuration data
     */
    constructor(data: ChainData) {
        this.name = data.name;
        this.chain = data.chain;
        this.blockExplorerPrefix = data.blockExplorerPrefix;
        this.blockExplorerPostfix = data.blockExplorerPostfix;
        this.blockExplorerHasIframe = data.blockExplorerHasIframe;
        this.bgColor = data.bgColor;
        this.fontColor = data.fontColor;
        this.addrRegexPatterns = this.parseRegexPatterns(data.addrRegexPatterns);
        this.addrCaseSensitive = data.addrCaseSensitive;
        this.annotation = data.annotation;
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
            name: this.name,
            chain: this.chain,
            blockExplorerPrefix: this.blockExplorerPrefix,
            blockExplorerPostfix: this.blockExplorerPostfix,
            blockExplorerHasIframe: this.blockExplorerHasIframe,
            bgColor: this.bgColor,
            fontColor: this.fontColor,
            addrRegexPatterns: this.addrRegexPatterns.map(r => r.toString()),
            addrCaseSensitive: this.addrCaseSensitive,
            annotation: this.annotation,
        };
    }

    /**
     * Converts instance to string representation
     * @returns {string} String representation
     */
    toString(): string {
        return `${this.name} (${this.chain})`;
    }
}
