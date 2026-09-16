/** Snapshot-only preflight. Keep this module out of execution until the caller can place it immediately before source submission. */
import { decodeFunctionData, parseAbi } from "viem";
import { inspectCircleV2UpfrontOffline, type CircleV2UpfrontInput } from "./circle-v2-upfront-offline.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";

const ABI_SIGNATURE = "depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes,address))";
const ABI = parseAbi([`function ${ABI_SIGNATURE} payable`]);
const VALIDATE_URL = "https://iris-api.circle.com/v2/quote/validate/usdc/6";
type Request = { readonly target: "circle"; readonly url: typeof VALIDATE_URL; readonly body: { readonly abiSignature: typeof ABI_SIGNATURE; readonly args: readonly (string | readonly string[])[] } }
  | { readonly target: "base"; readonly method: "eth_blockNumber" | "eth_call"; readonly params: readonly unknown[] };
export type CircleV2PreflightTransport = (request: Request) => Promise<unknown>;
export interface CircleV2PreflightInput extends CircleV2UpfrontInput { readonly payer: string }
export interface CircleV2PreflightSnapshot { readonly kind: "circle_v2_preflight_snapshot"; readonly executionAdmitted: false; readonly blockNumber: string; readonly abiSignature: typeof ABI_SIGNATURE }
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_preflight_${reason}`); }
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value)) fail("block_quantity");
  return BigInt(value);
}
function integer(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("expiry_integer");
  return BigInt(value);
}
function sameHex(a: unknown, b: unknown): boolean { return bridgeHex(a, 16 * 1024) === bridgeHex(b, 16 * 1024); }

/** Both external checks are observations at one source block; the result never authorizes execution. */
export async function inspectCircleV2Preflight(input: CircleV2PreflightInput, transport: CircleV2PreflightTransport): Promise<CircleV2PreflightSnapshot> {
  const tx = bridgeRecord(input.transaction);
  const data = bridgeHex(tx.data);
  let decoded: ReturnType<typeof decodeFunctionData<typeof ABI>>;
  try { decoded = decodeFunctionData({ abi: ABI, data }); } catch { return fail("abi"); }
  if (decoded.functionName !== "depositForBurnWithHookAndFees" || !decoded.args) fail("abi");
  const [amount, destination, recipient, token, caller, hook, claim] = decoded.args;
  const args = [amount.toString(), destination.toString(), recipient, token, caller, hook,
    [claim[0], claim[1]]] as const;
  const response = bridgeRecord(input.quoteResponse);
  const payer = bridgeAddress(input.payer);
  const source = bridgeAddress(tx.to);
  const value = bridgeUint(tx.valueAtomic);
  let validation: Record<string, unknown>;
  try { validation = bridgeRecord(await transport({ target: "circle", url: VALIDATE_URL, body: { abiSignature: ABI_SIGNATURE, args } })); }
  catch { return fail("circle_unavailable"); }
  if (validation.claimable !== true || !Array.isArray(validation.failedChecks) || validation.failedChecks.length !== 0) fail("claimability");
  if (!sameHex(validation.signedQuote, response.signedQuote) || bridgeUint(validation.feeTotalAmount) !== bridgeUint(response.feeTotalAmount) ||
    bridgeAddress(validation.feeToken) !== bridgeAddress(response.feeToken) || bridgeUint(validation.nonce) !== bridgeUint(response.nonce)) fail("signed_fields");
  const quotedExpiry = bridgeRecord(response.expiry);
  const expiry = bridgeRecord(validation.expiry);
  if (expiry.mode !== quotedExpiry.mode || expiry.expired !== false || integer(expiry.secondsRemaining) === 0n) fail("expiry");
  if (expiry.mode === "BLOCK_NUMBER") {
    if (integer(expiry.expiresAtBlock) !== integer(quotedExpiry.expiresAtBlock)) fail("expiry");
  } else if (expiry.mode === "TIMESTAMP") {
    if (integer(expiry.expiresAt) !== integer(quotedExpiry.expiresAt) || integer(expiry.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) fail("expiry");
  } else fail("expiry");
  if (!Array.isArray(validation.items) || !Array.isArray(response.items) || validation.items.length !== response.items.length) fail("items");
  for (let i = 0; i < response.items.length; i += 1) {
    const actual = bridgeRecord(validation.items[i]), expected = bridgeRecord(response.items[i]);
    if (actual.argsMatch !== true || actual.type !== expected.type || bridgeUint(actual.amount) !== bridgeUint(expected.amount) ||
      !sameHex(actual.argsHash, expected.argsHash)) fail("item_binding");
    if (actual.computedArgsHash !== undefined && !sameHex(actual.computedArgsHash, expected.argsHash)) fail("item_binding");
    const actualArgs = actual.args, expectedArgs = expected.args;
    if (actualArgs !== undefined && (!Array.isArray(actualArgs) || !Array.isArray(expectedArgs) ||
      actualArgs.length !== expectedArgs.length || actualArgs.some((arg, index) => !sameHex(arg, expectedArgs[index])))) fail("item_args");
  }
  let block: bigint;
  try { block = quantity(await transport({ target: "base", method: "eth_blockNumber", params: [] })); }
  catch { return fail("base_unavailable"); }
  await inspectCircleV2UpfrontOffline({ ...input, sourceBlockNumber: block.toString() });
  if (expiry.mode === "BLOCK_NUMBER" && block >= integer(expiry.expiresAtBlock)) fail("expired_block");
  const tag = `0x${block.toString(16)}`;
  try {
    bridgeHex(await transport({ target: "base", method: "eth_call", params: [{ from: payer, to: source, data, value: `0x${value.toString(16)}` }, tag] }));
  } catch { return fail("simulation_reverted"); }
  let after: bigint;
  try { after = quantity(await transport({ target: "base", method: "eth_blockNumber", params: [] })); }
  catch { return fail("base_unavailable"); }
  if (after !== block) fail("stale_block");
  return { kind: "circle_v2_preflight_snapshot", executionAdmitted: false, blockNumber: block.toString(), abiSignature: ABI_SIGNATURE };
}
