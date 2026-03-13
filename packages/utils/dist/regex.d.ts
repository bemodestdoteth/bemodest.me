/**
 * @name convertToExtractionPattern
 * @desc Converts a strict regex pattern (e.g., ^[...]$) into an extraction pattern with delimiters (RULES Q-2002)
 * @param {string} pattern - The strict regex pattern to convert
 * @returns {string} The converted extraction pattern
 * @example convertToExtractionPattern('^[1-5a-z\\.]{1,12}$') // returns '/(^|\\s|:|-|\\[)([1-5a-z\\.]{1,12})($|\\s|\\])/gi'
 */
export declare function transformToExtractionPattern(pattern: string): string;
/**
 * Compiles address regex patterns from chains into native RegExp objects.
 * Also generates regex fingerprints for compatibility checking.
 * @param {Array<any>} chains - Array of chain documents
 * @returns {{ chainRegexMap: Record<string, RegExp[]>, regexFingerprintMap: Record<string, string> }}
 */
export declare function compileChainRegexes(chains: any[]): {
    chainRegexMap: Record<string, RegExp[]>;
    regexFingerprintMap: Record<string, string>;
};
