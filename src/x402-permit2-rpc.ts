import { keccak256 } from "viem";
import { sha256 } from "./canonical.js";
import { nonzeroBytes32, record, rpcHex, rpcQuantity, rpcUint256Data } from "./base-rpc-codec.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import type { X402Asset } from "./x402-network.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_EXACT_PERMIT2_PROXY_CODE_HASH, canonicalPermit2Code } from "./x402-permit2/registry.js";

type Call = (method: string, params: readonly unknown[]) => Promise<unknown>;
type Batch = (calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]) => Promise<readonly unknown[]>;

/** What prepare proves for a Permit2 offer, all at one block of the asset's proof tag. */
export interface X402Permit2PrepareEvidence {
  readonly address: Address;
  /** The token balance (the field name is shared with the EIP-3009 evidence). */
  readonly usdcAtomic: string;
  readonly allowanceAtomic: string;
  readonly rpcOriginHash: string;
  readonly observedAt: string;
  readonly queriedTag: "safe" | "finalized";
  readonly block: { readonly number: string; readonly hash: Hex; readonly timestamp: string };
  readonly tokenFacts: { readonly decimals: number; readonly nonceUnused: true };
  /** Read only when a short allowance needs the seller-sponsored permit: the token's DOMAIN_SEPARATOR and permit nonce. */
  readonly permit?: { readonly domainSeparator: Hex; readonly nonce: string };
}

const word = (value: string) => value.slice(2).toLowerCase().padStart(64, "0");
const call = (to: string, data: string, pinned: unknown) => ({ method: "eth_call", params: [{ to, data }, pinned] });
const nonceBitmap = (owner: string, nonce: Hex) => `0x4fe02b44${word(owner)}${(BigInt(nonce) >> 8n).toString(16).padStart(64, "0")}`;

/**
 * One header at the proof tag, then one batch pinned to it (EIP-1898): balance, allowance to Permit2, decimals, the
 * Permit2 nonce word of the fresh nonce, and the Permit2 and x402 exact proxy runtimes, which must be the canonical
 * deployments for this chain. A third pinned batch reads the token's domain and permit nonce only when `permitNeeded`.
 */
export async function readX402Permit2PrepareEvidence(input: { readonly call: Call; readonly batch: Batch; readonly rpcOrigin: string;
  readonly asset: X402Asset; readonly address: Address; readonly nonce: Hex; readonly permitNeeded: (allowanceAtomic: string) => boolean }): Promise<X402Permit2PrepareEvidence> {
  const { asset, address, nonce } = input, tag = asset.proofTag;
  if (!/^0x[0-9a-f]{64}$/u.test(nonce)) throw new ApnError("APN_INTERNAL", "Permit2 probe nonce is missing.");
  const header = record(await input.call("eth_getBlockByNumber", [tag, false]), `${tag} block`);
  const block = { number: rpcQuantity(header.number).toString(), hash: nonzeroBytes32(header.hash, `${tag} block hash`),
    timestamp: rpcQuantity(header.timestamp).toString() };
  const pinned = { blockHash: block.hash, requireCanonical: true };
  const refused = (error: unknown): never => {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_PROTOCOL") throw error;
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `The token ${asset.token} on ${asset.network} did not answer balanceOf, allowance and ` +
      "decimals at one block, or this RPC refused the reads.", { reason: "x402_token_reads_failed", chain: asset.network, asset: asset.token });
  };
  const values = await input.batch([
    call(asset.token, `0x70a08231${word(address)}`, pinned),
    call(asset.token, `0xdd62ed3e${word(address)}${word(PERMIT2_ADDRESS)}`, pinned),
    call(asset.token, "0x313ce567", pinned),
    call(PERMIT2_ADDRESS, nonceBitmap(address, nonce), pinned),
    { method: "eth_getCode", params: [PERMIT2_ADDRESS, pinned] },
    { method: "eth_getCode", params: [X402_EXACT_PERMIT2_PROXY, pinned] },
  ]).catch(refused);
  // Both contracts are immutable at their CREATE2 addresses: Permit2's runtime is one template with this chain's own
  // immutables, and the proxy has one runtime on every chain.
  if (!canonicalPermit2Code(rpcHex(values[4]), asset.chainId) || keccak256(rpcHex(values[5])) !== X402_EXACT_PERMIT2_PROXY_CODE_HASH) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `Canonical Permit2 or the x402 exact proxy is not deployed with its expected code on ${asset.network}.`,
      { reason: "x402_permit2_contracts_unverified", chain: asset.network });
  }
  const decimals = BigInt(rpcHex(values[2], 32)), bits = BigInt(rpcHex(values[3], 32));
  if (decimals > 255n) throw new ApnError("APN_RPC_PROTOCOL", "The x402 token's decimals() is not a uint8.", { reason: "x402_token_decimals_invalid" });
  if (((bits >> (BigInt(nonce) & 255n)) & 1n) !== 0n) throw new ApnError("APN_RPC_PROTOCOL", "A fresh Permit2 nonce reads as used.");
  const allowanceAtomic = rpcUint256Data(values[1], "Permit2 allowance");
  let permit: X402Permit2PrepareEvidence["permit"];
  if (input.permitNeeded(allowanceAtomic)) {
    const read = await input.batch([call(asset.token, "0x3644e515", pinned), call(asset.token, `0x7ecebe00${word(address)}`, pinned)]).catch(refused);
    permit = { domainSeparator: rpcHex(read[0], 32), nonce: rpcUint256Data(read[1], "token permit nonce") };
  }
  return { address, usdcAtomic: rpcUint256Data(values[0], "token balance"), allowanceAtomic, rpcOriginHash: sha256(input.rpcOrigin),
    observedAt: new Date().toISOString(), queriedTag: tag, block, tokenFacts: { decimals: Number(decimals), nonceUnused: true },
    ...(permit === undefined ? {} : { permit }) };
}

/** Permit2's unordered nonce bit of `owner` at a block; APN signs one witness transfer per random nonce and never cancels one. */
export async function readX402Permit2NonceBit(input: { readonly call: Call; readonly owner: Address; readonly nonce: Hex; readonly blockNumber: string }): Promise<boolean> {
  const tag = `0x${BigInt(input.blockNumber).toString(16)}`;
  const bits = BigInt(rpcHex(await input.call("eth_call", [{ to: PERMIT2_ADDRESS, data: nonceBitmap(input.owner, input.nonce) }, tag]), 32));
  return ((bits >> (BigInt(input.nonce) & 255n)) & 1n) === 1n;
}
