import { getTokenEncoder } from "@solana-program/token";
import { address, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder } from "@solana/kit";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { associatedTokenAddress, whirlpoolTickArrayAddress, type TickArrayState, type WhirlpoolState } from "../../src/swap/orca-solana/accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";
import { quoteWhirlpoolExactInAToB } from "../../src/swap/orca-solana/math.js";
import { type OrcaStablePrepareInput } from "../../src/swap/orca-solana/stable-prepare.js";
export const raw = (owner: string, data: Buffer, lamports = 3_000_000n) => ({ owner, data, lamports, space: data.length, executable: false });
export const token = (mint: string, owner: string, amount: bigint) => raw(TOKEN_PROGRAM, Buffer.from(getTokenEncoder().encode({
  mint: mint as never, owner: owner as never, amount, delegate: { __option: "None" }, state: 1,
  isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" },
})));
export async function input(exists = true): Promise<OrcaStablePrepareInput> {
  const owner = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 23))).address;
  const encode = (key: string) => Buffer.from(getAddressEncoder().encode(address(key)));
  const poolBytes = Buffer.alloc(653);
  Buffer.from("3f95d10ce1806309", "hex").copy(poolBytes);
  encode(WHIRLPOOLS_CONFIG).copy(poolBytes, 8);
  poolBytes.writeUInt16LE(1, 41); poolBytes.writeUInt16LE(1, 43); poolBytes.writeUInt16LE(100, 45);
  poolBytes.writeBigUInt64LE(4_587_626_145_939_386n, 49);
  poolBytes.writeBigUInt64LE(1_000_000_000_000n, 65); poolBytes.writeBigUInt64LE(1n, 73);
  encode(USDC_MINT).copy(poolBytes, 101); encode(ORCA_STABLE_VAULT_A).copy(poolBytes, 133);
  encode(SOLANA_USDT).copy(poolBytes, 181); encode(ORCA_STABLE_VAULT_B).copy(poolBytes, 213);
  const pool: WhirlpoolState = { address: ORCA_STABLE_POOL, config: WHIRLPOOLS_CONFIG, tickSpacing: 1,
    feeTierIndexSeed: 1, feeRate: 100, protocolFeeRate: 0, liquidity: 4_587_626_145_939_386n,
    sqrtPrice: 1_000_000_000_000n + (1n << 64n), tickCurrentIndex: 0,
    mintA: USDC_MINT, mintB: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B };
  const starts = [0, -88, -176];
  const arrays: TickArrayState[] = [];
  const arrayBytes = [];
  for (const start of starts) {
    const key = await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start);
    const bytes = Buffer.alloc(9_988); Buffer.from("4561bdbe6e0742bb", "hex").copy(bytes);
    bytes.writeInt32LE(start, 8); encode(ORCA_STABLE_POOL).copy(bytes, 9_956);
    arrayBytes.push(raw(WHIRLPOOL_PROGRAM, bytes));
    arrays.push({ address: key, startTickIndex: start, whirlpool: ORCA_STABLE_POOL,
      ticks: Array.from({ length: 88 }, () => ({ initialized: false, liquidityNet: 0n })) });
  }
  const expected = BigInt(quoteWhirlpoolExactInAToB(pool, arrays, 1_000_000n).amountOutAtomic);
  const minimum = (expected * 9_950n + 9_999n) / 10_000n;
  return { owner, quote: { chain: ORCA_SOLANA_CHAIN, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B,
    direction: "USDC_to_USDT_exact_input", slot: "450687913", amountInAtomic: "1000000", expectedOutputAtomic: expected.toString(),
    minimumOutputAtomic: minimum.toString(), tickCurrentIndex: 0, tickArrayStarts: starts, slippageBps: 50,
    signed: false, broadcast: false },
  snapshot: { slot: "450687913", owner: raw(SYSTEM_PROGRAM, Buffer.alloc(0), 20_000_000n),
    usdcAta: token(USDC_MINT, owner, 2_000_000n), usdtAta: exists ? token(SOLANA_USDT, owner, 0n) : null,
    usdcAtaAddress: await associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM),
    usdtAtaAddress: await associatedTokenAddress(owner, SOLANA_USDT, TOKEN_PROGRAM),
    pool: raw(WHIRLPOOL_PROGRAM, poolBytes), tickArrays: arrayBytes,
    vaultA: token(USDC_MINT, ORCA_STABLE_POOL, 339_542_399_990n),
    vaultB: token(SOLANA_USDT, ORCA_STABLE_POOL, 379_676_358_729n), oracle: null },
  lifetime: { blockhash: "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4", currentBlockHeight: "400000000", lastValidBlockHeight: "400000100" },
  computeUnitLimit: 250000, computeUnitPriceMicroLamports: "0", maximumTotalFeeLamports: "3000000", createUsdtAta: !exists,
  ...(exists ? {} : { usdtAtaRentLamports: "2000000", maximumAtaRentLamports: "2500000" }) };
}
