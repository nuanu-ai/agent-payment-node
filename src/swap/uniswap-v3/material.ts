import { getAddress, type Hex } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote, type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import type { UniswapTransactionEnvelope } from "../uniswap-codec.js";
import { UNISWAP_CHAIN, UNISWAP_ROUTER } from "../uniswap-pin.js";
import { decodeUniswapRouterCalldata } from "../uniswap-router.js";
import type { UniswapV3PoolQuote } from "./onchain.js";
import { uniswapV3Pair, type UniswapV3CodePin } from "./pins.js";

export const UNISWAP_KEYLESS_EXECUTION_SCHEMA = "apn.uniswap-v3-keyless-execution.v1" as const;
export const UNISWAP_KEYLESS_EVIDENCE_DOMAIN = "apn.uniswap-v3-onchain-evidence.v1" as const;

/** Read-only chain facts behind one quote. Its domain hash is the quote's providerResponseHash. */
export interface UniswapKeylessEvidence {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: Hex;
  readonly baseFeePerGas: string;
  readonly accountBalanceWei: string;
  readonly codePins: readonly UniswapV3CodePin[];
  readonly pool: UniswapV3PoolQuote;
}
export interface UniswapKeylessExecution {
  readonly schemaVersion: typeof UNISWAP_KEYLESS_EXECUTION_SCHEMA;
  readonly envelope: UniswapTransactionEnvelope;
  readonly deadline: number;
  readonly evidence: UniswapKeylessEvidence;
}
export interface UniswapKeylessMaterial extends GuardedSwapPreparedMaterial {
  readonly quote: SwapQuoteSnapshot;
  readonly approvalCapAtomic: "0";
  readonly execution: UniswapKeylessExecution;
}

export function uniswapEvidenceHash(evidence: UniswapKeylessEvidence): string {
  return domainHash(UNISWAP_KEYLESS_EVIDENCE_DOMAIN, canonicalJson(evidence));
}

/** Proves the stored unsigned transaction, gas display and chain evidence are exactly the ones the quote hash binds. */
export function validateUniswapKeylessMaterial(value: unknown, mode: "input" | "stored" = "stored"): UniswapKeylessMaterial {
  const fail = (message: string): never => { throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message); };
  if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) ||
      value.approvalCapAtomic !== "0" || !isPlainRecord(value.execution) || !isPlainRecord(value.gasOrEnergy)) fail("Uniswap prepared material schema is invalid.");
  const record = value as Record<string, unknown>, quote = validateSwapQuote(record.quote, mode);
  const execution = record.execution as Record<string, unknown>;
  if (!exactKeys(execution, ["schemaVersion", "envelope", "deadline", "evidence"]) || execution.schemaVersion !== UNISWAP_KEYLESS_EXECUTION_SCHEMA ||
      !isPlainRecord(execution.envelope) || !isPlainRecord(execution.evidence) || typeof execution.deadline !== "number") fail("Uniswap execution material is invalid.");
  const envelope = execution.envelope as unknown as UniswapTransactionEnvelope, deadline = execution.deadline as number;
  const evidence = execution.evidence as unknown as UniswapKeylessEvidence;
  if (quote.sourceAsset.chain !== UNISWAP_CHAIN || quote.sourceAsset.kind !== "native" || quote.destinationAsset.kind !== "token" ||
      quote.destinationAsset.identifier === null) fail("Uniswap material is not a pinned native exact-input pair.");
  const pair = uniswapV3Pair(quote.destinationAsset.identifier!);
  if (!exactKeys(envelope as unknown as Record<string, unknown>, ["from", "to", "data", "value", "gasLimit", "chainId", "maxFeePerGas", "maxPriorityFeePerGas"]) ||
      envelope.from !== quote.account || envelope.to !== UNISWAP_ROUTER || envelope.chainId !== 1 || envelope.value !== quote.inputAmountAtomic ||
      typeof envelope.data !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(envelope.data) || envelope.data.length > 131_074 ||
      sha256(canonicalJson(envelope)) !== quote.unsignedTransactionPayloadHash || !Number.isSafeInteger(deadline) ||
      deadline !== Math.floor(Date.parse(quote.expiresAt) / 1000)) fail("Uniswap unsigned transaction is not bound to its quote.");
  const gasLimit = uint(envelope.gasLimit, fail), maxFee = uint(envelope.maxFeePerGas, fail), priority = uint(envelope.maxPriorityFeePerGas ?? "", fail, false);
  if (priority > maxFee || BigInt(quote.simulation.gasEstimate) > gasLimit) fail("Uniswap gas envelope is inconsistent.");
  if (canonicalJson(record.gasOrEnergy) !== canonicalJson(uniswapGasDisplay(envelope))) fail("Uniswap gas display is not bound to the envelope.");
  const route = decodeUniswapRouterCalldata(envelope.data, { recipient: quote.recipient, inputAmountAtomic: quote.inputAmountAtomic,
    minimumOutputAtomic: quote.minimumOutputAtomic, deadline });
  if (route.routeHash !== quote.routeHash || route.minimumOutputAtomic !== quote.minimumOutputAtomic) fail("Uniswap route is not bound to its quote.");
  if (!exactKeys(evidence as unknown as Record<string, unknown>, ["chainId", "blockNumber", "blockHash", "baseFeePerGas", "accountBalanceWei", "codePins", "pool"]) ||
      evidence.chainId !== 1 || evidence.blockNumber !== quote.simulation.blockNumber || evidence.blockHash !== quote.simulation.blockHash ||
      !isPlainRecord(evidence.pool) || evidence.pool.pool !== pair.pool || evidence.pool.fee !== pair.fee ||
      evidence.pool.amountOutAtomic !== quote.expectedOutputAtomic || uniswapEvidenceHash(evidence) !== quote.providerResponseHash) {
    fail("Uniswap on-chain quote evidence is not bound to its quote.");
  }
  if (getAddress(pair.pool) !== pair.pool) fail("Uniswap pair pin is not canonical.");
  return value as unknown as UniswapKeylessMaterial;
}

export function uniswapGasDisplay(envelope: UniswapTransactionEnvelope): Readonly<Record<string, string>> {
  const maxFee = envelope.maxFeePerGas ?? envelope.gasPrice!;
  return { gasLimit: envelope.gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas ?? "0",
    maximumGasCostWei: (BigInt(envelope.gasLimit) * BigInt(maxFee)).toString() };
}

/** Saved-quote store: GuardedSwapReadOnlyBuilder.load resolves prepared material here by quote hash. */
export class SavedUniswapQuoteStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(value: UniswapKeylessMaterial): Promise<UniswapKeylessMaterial> {
    const material = validateUniswapKeylessMaterial(value, "input"); await this.ready();
    return await this.withLocks([`swap-quote:${material.quote.quoteHash}`], async () => {
      const existing = await this.readJson(this.path(material.quote.quoteHash));
      if (existing !== null) {
        if (canonicalJson(validateUniswapKeylessMaterial(existing)) !== canonicalJson(material)) {
          throw new ApnError("APN_STATE_CORRUPT", "A different Uniswap material already owns this quote hash.");
        }
        return material;
      }
      await this.writeJson(this.path(material.quote.quoteHash), material, true);
      return material;
    });
  }
  async load(quoteHash: string): Promise<UniswapKeylessMaterial | null> {
    stateIdentifier(quoteHash, "swap quote hash"); await this.ready();
    const value = await this.readJson(this.path(quoteHash)); if (value === null) return null;
    const material = validateUniswapKeylessMaterial(value);
    if (material.quote.quoteHash !== quoteHash) throw new ApnError("APN_STATE_CORRUPT", "Saved Uniswap quote path binding is invalid.");
    return material;
  }
  private path(quoteHash: string): string { return `swap-quotes/${quoteHash}.json`; }
  private async ready(): Promise<void> { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("swap-quotes"); })(); await this.initialized; }
}

function uint(value: unknown, fail: (message: string) => never, positive = true): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value) || (positive && value === "0")) fail("Uniswap gas integer is invalid.");
  return BigInt(value as string);
}
