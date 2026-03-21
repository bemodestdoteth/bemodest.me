import { describe, it, expect, vi, beforeEach } from 'vitest';
import { solanaBalanceUsd } from '../blockchain';
import { Connection } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, AccountLayout, MintLayout } from '@solana/spl-token';

// Mock dependencies
vi.mock('@solana/web3.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        Connection: vi.fn(),
    };
});

vi.mock('@solana/spl-token', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getAssociatedTokenAddressSync: vi.fn(),
        AccountLayout: { decode: vi.fn() },
        MintLayout: { decode: vi.fn() },
    };
});

describe('solanaBalanceUsd', () => {
    const mockRpcUrl = 'https://mock.rpc.com';
    const mockPrice = 1.5;
    const mockContractAddr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const addrs = [
        '11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 0 when ATAs do not exist (getMultipleAccountsInfo returns nulls)', async () => {
        // Mint + 2 ATAs
        const mockGetMultipleAccountsInfo = vi.fn().mockResolvedValue([{ data: Buffer.from('') }, null, null]);
        vi.mocked(Connection).mockImplementation(function () {
            return {
                getMultipleAccountsInfo: mockGetMultipleAccountsInfo,
            }
        } as any);

        vi.mocked(getAssociatedTokenAddressSync).mockImplementation((mint, owner) => {
            return { toBase58: () => `ata-${owner.toBase58()}` } as any;
        });

        // Mock mint decimals = 6
        vi.mocked(MintLayout.decode).mockReturnValue({ decimals: 6 } as any);

        const result = await solanaBalanceUsd(addrs, mockContractAddr, mockPrice, mockRpcUrl);

        expect(result).toBe(0);
        expect(mockGetMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    });

    it('sums balances across multiple wallets in one RPC call', async () => {
        // Mint + 2 ATAs
        const mockGetMultipleAccountsInfo = vi.fn().mockResolvedValue([
            { data: Buffer.from('mint_data') },
            { data: Buffer.from('acc1_data') },
            { data: Buffer.from('acc2_data') }
        ]);

        vi.mocked(Connection).mockImplementation(function () {
            return {
                getMultipleAccountsInfo: mockGetMultipleAccountsInfo,
            }
        } as any);

        vi.mocked(getAssociatedTokenAddressSync).mockImplementation((mint, owner) => {
            return { toBase58: () => `ata-${owner.toBase58()}` } as any;
        });

        vi.mocked(MintLayout.decode).mockReturnValue({ decimals: 6 } as any);

        // Mock account decodes: wallet1 has 10 (10_000_000), wallet2 has 20
        vi.mocked(AccountLayout.decode).mockImplementation((buf: any) => {
            if (buf.toString() === 'acc1_data') return { amount: 10_000_000n } as any;
            if (buf.toString() === 'acc2_data') return { amount: 20_000_000n } as any;
            return { amount: 0n } as any;
        });

        const result = await solanaBalanceUsd(addrs, mockContractAddr, mockPrice, mockRpcUrl);

        // 30 tokens * 1.5 price
        expect(result).toBe(45);
        expect(mockGetMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    });

    it('returns null if ALL accounts fail / RPC error', async () => {
        const mockGetMultipleAccountsInfo = vi.fn().mockRejectedValue(new Error('RPC Error'));
        vi.mocked(Connection).mockImplementation(function () {
            return {
                getMultipleAccountsInfo: mockGetMultipleAccountsInfo,
            }
        } as any);

        const result = await solanaBalanceUsd(addrs, mockContractAddr, mockPrice, mockRpcUrl);

        expect(result).toBeNull();
        expect(mockGetMultipleAccountsInfo).toHaveBeenCalledTimes(3); // 3 retries
    });

    it('native SOL path (no contractAddr) still works and batches getMultipleAccountsInfo', async () => {
        const mockGetMultipleAccountsInfo = vi.fn().mockResolvedValue([
            { lamports: 1_000_000_000 }, // 1 SOL
            { lamports: 2_000_000_000 }  // 2 SOL
        ]);

        vi.mocked(Connection).mockImplementation(function () {
            return {
                getMultipleAccountsInfo: mockGetMultipleAccountsInfo,
            }
        } as any);

        const result = await solanaBalanceUsd(addrs, null, mockPrice, mockRpcUrl);

        // 3 SOL * 1.5 = 4.5
        expect(result).toBe(4.5);
    });
});
