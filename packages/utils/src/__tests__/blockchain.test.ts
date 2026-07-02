import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evmBalanceUsd, evmNativeBalanceUsd, getBalanceOnChain, solanaBalanceUsd } from '../blockchain';
import { Connection } from '@solana/web3.js';
import { createPublicClient } from 'viem';
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

vi.mock('viem', async (importOriginal) => {
    const actual = await importOriginal() as object;
    return {
        ...actual,
        createPublicClient: vi.fn(),
    };
});

const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockRpcUrl = 'https://mock.rpc.com';
const evmAddress = '0x0000000000000000000000000000000000000001';
const evmAddressTwo = '0x0000000000000000000000000000000000000002';
const tokenAddress = '0x0000000000000000000000000000000000000003';

function mockEvmClient(overrides: {
    getBalance?: ReturnType<typeof vi.fn>;
    readContract?: ReturnType<typeof vi.fn>;
}) {
    const client = {
        getBalance: overrides.getBalance ?? vi.fn(),
        readContract: overrides.readContract ?? vi.fn(),
    };
    mockCreatePublicClient.mockReturnValue(client as never);
    return client;
}

describe('EVM balance helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns native USD value from viem getBalance', async () => {
        const getBalance = vi.fn().mockResolvedValue(2_000_000_000_000_000_000n);
        mockEvmClient({ getBalance });

        const result = await evmNativeBalanceUsd(evmAddress, 'eip155:8453', 1500, mockRpcUrl);

        expect(result).toBe(3000);
        expect(getBalance).toHaveBeenCalledWith({ address: evmAddress });
        expect(mockCreatePublicClient).toHaveBeenCalledWith(expect.objectContaining({
            chain: expect.objectContaining({ id: 8453 }),
        }));
    });

    it('returns ERC20 USD value from viem readContract balance and decimals', async () => {
        const readContract = vi.fn()
            .mockResolvedValueOnce(123_450_000n)
            .mockResolvedValueOnce(6);
        mockEvmClient({ readContract });

        const result = await evmBalanceUsd(evmAddress, 'eip155:8453', tokenAddress, 2, mockRpcUrl);

        expect(result).toBe(246.9);
        expect(readContract).toHaveBeenNthCalledWith(1, expect.objectContaining({
            address: tokenAddress,
            functionName: 'balanceOf',
            args: [evmAddress],
        }));
        expect(readContract).toHaveBeenNthCalledWith(2, expect.objectContaining({
            address: tokenAddress,
            functionName: 'decimals',
        }));
    });

    it('retries native balance after transient viem failure', async () => {
        vi.useFakeTimers();
        const getBalance = vi.fn()
            .mockRejectedValueOnce(new Error('temporary RPC failure'))
            .mockResolvedValueOnce(1_000_000_000_000_000_000n);
        mockEvmClient({ getBalance });

        const resultPromise = evmNativeBalanceUsd(evmAddress, 'eip155:1', 3, mockRpcUrl);
        await vi.runAllTimersAsync();

        await expect(resultPromise).resolves.toBe(3);
        expect(getBalance).toHaveBeenCalledTimes(2);
    });

    it('returns null after three ERC20 read failures', async () => {
        vi.useFakeTimers();
        const readContract = vi.fn().mockRejectedValue(new Error('RPC down'));
        mockEvmClient({ readContract });

        const resultPromise = evmBalanceUsd(evmAddress, 'eip155:1', tokenAddress, 2, mockRpcUrl);
        await vi.runAllTimersAsync();

        await expect(resultPromise).resolves.toBeNull();
        expect(readContract).toHaveBeenCalledTimes(6);
    });

    it('getBalanceOnChain sums EVM native balances across wallets', async () => {
        const getBalance = vi.fn()
            .mockResolvedValueOnce(1_000_000_000_000_000_000n)
            .mockResolvedValueOnce(2_000_000_000_000_000_000n);
        mockEvmClient({ getBalance });

        const result = await getBalanceOnChain('eip155:8453', [evmAddress, evmAddressTwo], null, 10, mockRpcUrl);

        expect(result).toBe(30);
        expect(getBalance).toHaveBeenCalledTimes(2);
    });

    it('getBalanceOnChain sums EVM ERC20 balances across wallets', async () => {
        const readContract = vi.fn()
            .mockResolvedValueOnce(100_000_000n)
            .mockResolvedValueOnce(6)
            .mockResolvedValueOnce(200_000_000n)
            .mockResolvedValueOnce(6);
        mockEvmClient({ readContract });

        const result = await getBalanceOnChain('eip155:8453', [evmAddress, evmAddressTwo], tokenAddress, 1.5, mockRpcUrl);

        expect(result).toBe(450);
        expect(readContract).toHaveBeenCalledTimes(4);
    });
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
