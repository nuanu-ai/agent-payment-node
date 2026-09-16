/** Read-only, one-block Base source preflight. No execution path imports this module. */
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import type { Address, Hex } from "../model.js";
import { canonicalJson, sha256 } from "../canonical.js";
import { inspectNearBaseTronQuoteOffline, type NearTronOfflineBinding } from "./near-tron-offline.js";
import { verifyNearBaseTronSignatureOffline } from "./near-tron-signature-offline.js";
import { BRIDGE_DIAMOND, bridgeFailure, bridgeRecord } from "./validation.js";

const loupeAbi = parseAbi(["function facetAddress(bytes4 selector) view returns (address)"]);
const consumedAbi = parseAbi(["function isQuoteConsumed(bytes32 quoteId) view returns (bool)"]);
const SELECTOR = "0x3110c7b9" as Hex;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
function fail(reason: string): never { return bridgeFailure("APN_RPC_PROTOCOL", `near_tron_preflight_${reason}`); }
function quantity(value: unknown): bigint { if (typeof value !== "string" || !QUANTITY.test(value)) fail("rpc_quantity"); return BigInt(value); }
function bytes(value: unknown): Hex { if (typeof value !== "string" || !HEX.test(value)) fail("rpc_bytes"); return value as Hex; }

export interface NearTronReadOnlyRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}
export interface NearTronPreflightPins {
  /** Operator-confirmed currently installed facet bytecode hash. */
  readonly facetCodeHash: Hex;
  /** Operator-confirmed signer from the installed facet deployment provenance. */
  readonly backendSigner: Address;
  /** SHA-256 of canonicalJson of the entire frozen quote. */
  readonly quoteSha256: string;
  /** Trusted wall clock, never quote metadata or an RPC response. */
  readonly nowUnixSeconds: string;
  /** Maximum age of the RPC safe block in seconds. */
  readonly maxSafeBlockAgeSeconds: number;
}
export interface NearTronPreflightProof {
  readonly kind: "read_only_near_tron_source_preflight";
  readonly executionAdmitted: false;
  readonly bridgeCompletion: false;
  readonly blockNumber: string;
  readonly blockHash: Hex;
  readonly facet: Address;
  readonly facetCodeHash: Hex;
  readonly backendSigner: Address;
  readonly quoteSha256: string;
  readonly quoteId: Hex;
  readonly calldataSha256: string;
  readonly simulation: "success";
}

/** Samples a current safe Base block and pins every state read and the exact payer simulation to it. */
export async function preflightNearBaseTronSourceReadOnly(
  quote: unknown, binding: NearTronOfflineBinding, pins: NearTronPreflightPins, rpc: NearTronReadOnlyRpc,
): Promise<NearTronPreflightProof> {
  if (!HASH.test(pins.facetCodeHash) || !/^[a-f0-9]{64}$/u.test(pins.quoteSha256) ||
    !Number.isSafeInteger(pins.maxSafeBlockAgeSeconds) || pins.maxSafeBlockAgeSeconds < 0) fail("pins");
  let signer: Address;
  try { signer = getAddress(pins.backendSigner); } catch { return fail("signer_pin"); }
  if (signer === "0x0000000000000000000000000000000000000000") fail("signer_pin");
  if (sha256(canonicalJson(quote)) !== pins.quoteSha256) fail("quote_changed");
  const inspection = inspectNearBaseTronQuoteOffline(quote, binding);
  const now = BigInt(pins.nowUnixSeconds);
  if (now < 0n) fail("clock");
  const call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    try { return await rpc.request(method, params); } catch { return fail(`rpc_${method}`); }
  };
  if (quantity(await call("eth_chainId", [])) !== 8453n) fail("chain");
  const sampled = bridgeRecord(await call("eth_getBlockByNumber", ["safe", false]), "APN_RPC_PROTOCOL");
  const blockNumber = quantity(sampled.number), blockTime = quantity(sampled.timestamp);
  if (typeof sampled.hash !== "string" || !HASH.test(sampled.hash) || blockNumber === 0n ||
    blockTime > now || now - blockTime > BigInt(pins.maxSafeBlockAgeSeconds)) fail("stale_safe_block");
  const block = `0x${blockNumber.toString(16)}` as Hex;
  const blockHash = sampled.hash as Hex;
  const rpcCall = async (to: Address, data: Hex, from?: Address, value?: Hex): Promise<Hex> =>
    bytes(await call("eth_call", [{ to, data, ...(from ? { from } : {}), ...(value ? { value } : {}) }, block]));
  const facetResult = await rpcCall(BRIDGE_DIAMOND, encodeFunctionData({ abi: loupeAbi, functionName: "facetAddress", args: [SELECTOR] }));
  let facet: Address;
  try { facet = getAddress(decodeFunctionResult({ abi: loupeAbi, functionName: "facetAddress", data: facetResult })); }
  catch { return fail("facet_decode"); }
  if (facet === "0x0000000000000000000000000000000000000000") fail("facet_missing");
  const code = bytes(await call("eth_getCode", [facet, block]));
  if (code === "0x") fail("facet_code_missing");
  const codeHash = keccak256(code);
  if (codeHash.toLowerCase() !== pins.facetCodeHash.toLowerCase()) fail("facet_code_changed");
  await verifyNearBaseTronSignatureOffline(quote, binding, {
    backendSigner: signer, diamond: BRIDGE_DIAMOND, chainId: 8453, nowUnixSeconds: pins.nowUnixSeconds,
  });
  // Strictly greater: the facet permits equality, but a quote expiring now cannot safely proceed.
  if (BigInt(inspection.deadline) <= now) fail("deadline");
  const consumedResult = await rpcCall(BRIDGE_DIAMOND,
    encodeFunctionData({ abi: consumedAbi, functionName: "isQuoteConsumed", args: [inspection.quoteId] }));
  let consumed: boolean;
  try { consumed = decodeFunctionResult({ abi: consumedAbi, functionName: "isQuoteConsumed", data: consumedResult }); }
  catch { return fail("consumed_decode"); }
  if (consumed) fail("quote_consumed");
  const tx = bridgeRecord(bridgeRecord(quote).transactionRequest);
  await rpcCall(BRIDGE_DIAMOND, tx.data as Hex, binding.sender, tx.value as Hex);
  // Detect a reorg during the reads; every state read above targeted the same numbered block.
  const finalBlock = bridgeRecord(await call("eth_getBlockByNumber", [block, false]), "APN_RPC_PROTOCOL");
  if (finalBlock.hash !== blockHash) fail("block_changed");
  return { kind: "read_only_near_tron_source_preflight", executionAdmitted: false, bridgeCompletion: false,
    blockNumber: block, blockHash, facet, facetCodeHash: codeHash, backendSigner: signer,
    quoteSha256: pins.quoteSha256, quoteId: inspection.quoteId, calldataSha256: inspection.calldataSha256,
    simulation: "success" };
}
