"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformToExtractionPattern = transformToExtractionPattern;
/**
 * @name convertToExtractionPattern
 * @desc Converts a strict regex pattern (e.g., ^[...]$) into an extraction pattern with delimiters (RULES Q-2002)
 * @param {string} pattern - The strict regex pattern to convert
 * @returns {string} The converted extraction pattern
 * @example convertToExtractionPattern('^[1-5a-z\\.]{1,12}$') // returns '/(^|\\s|:|-|\\[)([1-5a-z\\.]{1,12})($|\\s|\\])/gi'
 */
function transformToExtractionPattern(pattern) {
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
