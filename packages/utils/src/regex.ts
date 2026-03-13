/**
 * @name convertToExtractionPattern
 * @desc Converts a strict regex pattern (e.g., ^[...]$) into an extraction pattern with delimiters (RULES Q-2002)
 * @param {string} pattern - The strict regex pattern to convert
 * @returns {string} The converted extraction pattern
 * @example convertToExtractionPattern('^[1-5a-z\\.]{1,12}$') // returns '/(^|\\s|:|-|\\[)([1-5a-z\\.]{1,12})($|\\s|\\])/gi'
 */
export function transformToExtractionPattern(pattern: string): string {
    const trimmed = pattern.trim();

    // If it's already a slash-wrapped regex, don't double wrap
    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
        return trimmed;
    }

    // Remove anchors if they exist
    let inner = trimmed;
    if (inner.startsWith('^')) {
        inner = inner.substring(1);
    }
    if (inner.endsWith('$')) {
        inner = inner.substring(0, inner.length - 1);
    }

    // EOSIO/Antelope names specific delimiters plus brackets for bulk lists
    // Using double backslashes for string-based regex representation
    return `/(^|\\s|:|-|\\[)(${inner})($|\\s|\\])/gi`;
}

/**
 * Compiles address regex patterns from chains into native RegExp objects.
 * Also generates regex fingerprints for compatibility checking.
 * @param {Array<any>} chains - Array of chain documents
 * @returns {{ chainRegexMap: Record<string, RegExp[]>, regexFingerprintMap: Record<string, string> }}
 */
export function compileChainRegexes(chains: any[]) {
    const chainRegexMap: Record<string, RegExp[]> = {};
    const regexFingerprintMap: Record<string, string> = {};

    chains.forEach(chainDoc => {
        if (chainDoc.caip2 && chainDoc.addrRegexPatterns && chainDoc.addrRegexPatterns.length > 0) {
            const baseFlags = chainDoc.addrCaseSensitive === false ? 'i' : '';
            chainRegexMap[chainDoc.caip2] = chainDoc.addrRegexPatterns.map((patternStr: string) => {
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
                    console.error(`Invalid regex pattern for ${chainDoc.caip2}: ${patternStr}`);
                    return null;
                }
            }).filter((r: any) => r !== null);

            // Build fingerprint for same-regex constraint
            regexFingerprintMap[chainDoc.caip2] = JSON.stringify([...chainDoc.addrRegexPatterns].sort());
        }
    });

    return { chainRegexMap, regexFingerprintMap };
}
