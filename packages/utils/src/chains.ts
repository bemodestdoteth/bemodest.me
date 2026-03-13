/**
 * Identifies the blockchain ecosystem from a CAIP-2 identifier.
 * @param {string} caip2Id - The CAIP-2 identifier (e.g., 'eip155:1')
 * @returns {'evm' | 'solana' | 'sui' | 'cosmos' | 'bitcoin' | 'unknown'}
 */
export function getChainTypeFromCAIP2(caip2Id: string): string {
    const ns = caip2Id.split(':')[0];
    if (ns === 'eip155') return 'evm';
    if (ns === 'solana') return 'solana';
    if (ns === 'sui') return 'sui';
    if (ns === 'cosmos') return 'cosmos';
    if (ns === 'bip122') return 'bitcoin';
    return 'unknown';
}

/**
 * Extracts the numeric chain ID from an EVM (eip155) CAIP-2 identifier.
 * @param {string} caip2Id - The CAIP-2 identifier
 * @returns {number | null} - Numeric chain ID if it's an EVM chain, null otherwise
 */
export function getEipChainId(caip2Id: string): number | null {
    const [ns, chainId] = caip2Id.split(':');
    if (ns === 'eip155') return parseInt(chainId, 10);
    return null;
}
