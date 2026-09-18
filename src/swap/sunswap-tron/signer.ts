import { utils } from "tronweb";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { validateChainAccount } from "../../chain-account-store.js";
import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { tronAddress } from "../../tron/codec.js";
import type { SwapChainSignerPort, SwapChainSenderPort } from "../ports.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { SwapOperationRepository } from "../repository.js";
import { SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, SUNSWAP_TRON_CHAIN, SUNSWAP_USDT } from "./catalog.js";
import type { SunSwapSimulationProof } from "./simulation.js";
import {
  sunSwapUnsignedPayloadHash,
  validateSunSwapUnsignedTransaction,
  type SunSwapUnsignedIntent,
  type SunSwapUnsignedTransaction,
} from "./transaction.js";

export interface SunSwapExecutionBinding {
  readonly account: ChainAccount;
  readonly intent: SunSwapUnsignedIntent;
  readonly transaction: SunSwapUnsignedTransaction;
  readonly simulation: SunSwapSimulationProof;
}

export interface SunSwapBroadcastRpcPort {
  call(method: "wallet/broadcasttransaction", body: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/**
 * A per-operation protected adapter. Signed bytes remain in ChainAccountStore's authenticated
 * encrypted envelope; the public swap journal receives only the opaque binding fingerprint.
 */
export class SunSwapProtectedExecutionAdapter implements SwapChainSignerPort, SwapChainSenderPort {
  private readonly operation: SwapOperationRecord;
  private readonly fingerprint: string;

  constructor(
    private readonly storage: ChainWalletStoragePort,
    private readonly rpc: SunSwapBroadcastRpcPort,
    private readonly operations: SwapOperationRepository,
    operation: SwapOperationRecord,
    private readonly binding: SunSwapExecutionBinding,
  ) {
    this.operation = validateSwapOperation(operation);
    this.fingerprint = validateSunSwapExecutionBinding(this.operation, binding);
  }

  async sign(operationValue: SwapOperationRecord): Promise<{ readonly signedMaterialHandle: string }> {
    const operation = validateSwapOperation(operationValue);
    if ((operation.state !== "reserved" && operation.state !== "submitting") ||
        (operation.state === "submitting" && operation.submissionMarker === null) ||
        immutableOperationHash(operation) !== immutableOperationHash(this.operation) ||
        validateSunSwapExecutionBinding(operation, this.binding) !== this.fingerprint) mismatch();
    const existing = await this.effect();
    if (existing !== null) return { signedMaterialHandle: this.fingerprint };
    const signed = await this.storage.withSeed(this.binding.account, async (seed) =>
      signSunSwapTransaction(this.binding.transaction, this.binding.intent.owner, seed));
    const rawPayload = canonicalJson(signed);
    const effect: RailSignedEffect = { operationId: operation.operationId, fingerprint: this.fingerprint,
      transactionId: signed.txID, rawPayload, rawPayloadHash: sha256(rawPayload) };
    validateSunSwapEffect(effect, this.binding.transaction, this.binding.intent.owner, operation.operationId, this.fingerprint);
    await this.storage.saveEffect(this.binding.account, effect);
    return { signedMaterialHandle: this.fingerprint };
  }

  async recover(): Promise<{ readonly signedMaterialHandle: string } | null> {
    return await this.effect() === null ? null : { signedMaterialHandle: this.fingerprint };
  }

  async sendOnce(signedMaterialHandle: string, submissionMarkerHash: string): Promise<{ readonly transactionHash: string }> {
    if (signedMaterialHandle !== this.fingerprint || !/^[a-f0-9]{64}$/u.test(submissionMarkerHash)) mismatch();
    const durable = await this.operations.load(this.operation.ownerProfileHash, this.operation.operationId);
    if (durable === null || durable.state !== "submitting" || durable.submissionMarker?.markerHash !== submissionMarkerHash ||
        immutableOperationHash(durable) !== immutableOperationHash(this.operation) ||
        validateSunSwapExecutionBinding(durable, this.binding) !== this.fingerprint) mismatch();
    const effect = await this.effect();
    if (effect === null) mismatch();
    const transaction = validateSunSwapEffect(effect, this.binding.transaction, this.binding.intent.owner,
      this.operation.operationId, this.fingerprint);
    let response: unknown;
    try { response = await this.rpc.call("wallet/broadcasttransaction", transaction as unknown as Readonly<Record<string, unknown>>); }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") throw error;
      return ambiguous();
    }
    if (!isPlainRecord(response) || response.result !== true || response.txid !== transaction.txID ||
        Object.keys(response).some((key) => !["result", "txid", "code", "message"].includes(key))) ambiguous();
    return { transactionHash: transaction.txID };
  }

  private async effect(): Promise<RailSignedEffect | null> {
    const account = await this.storage.account(this.binding.account.profile, "tron");
    if (account === null || canonicalJson(account) !== canonicalJson(this.binding.account)) mismatch();
    const effect = await this.storage.effect(this.binding.account, this.operation.operationId, this.fingerprint);
    if (effect !== null) validateSunSwapEffect(effect, this.binding.transaction, this.binding.intent.owner,
      this.operation.operationId, this.fingerprint);
    return effect;
  }
}

export function validateSunSwapExecutionBinding(operationValue: unknown, bindingValue: unknown): string {
  const operation = validateSwapOperation(operationValue);
  if (!isPlainRecord(bindingValue) || !exactKeys(bindingValue, ["account", "intent", "transaction", "simulation"])) mismatch();
  const binding = bindingValue as unknown as SunSwapExecutionBinding;
  const account = validateChainAccount(binding.account);
  if (account.rail !== "tron" || account.network !== "mainnet" || account.provider !== "local" ||
      account.custody !== "local_software" || account.profile !== operation.quote.profile ||
      account.address !== operation.quote.account || binding.intent.owner !== account.address ||
      binding.intent.recipient !== operation.quote.recipient || binding.intent.inputAmountAtomic !== operation.quote.inputAmountAtomic ||
      binding.intent.minimumOutputAtomic !== operation.quote.minimumOutputAtomic || binding.intent.callValueAtomic !== operation.quote.inputAmountAtomic ||
      operation.quote.sourceAsset.chain !== SUNSWAP_TRON_CHAIN || operation.quote.sourceAsset.kind !== "native" ||
      operation.quote.sourceAsset.identifier !== null || operation.quote.destinationAsset.chain !== SUNSWAP_TRON_CHAIN ||
      operation.quote.destinationAsset.kind !== "token" || operation.quote.destinationAsset.identifier !== SUNSWAP_USDT ||
      operation.approvalCapAtomic !== "0") mismatch();
  const transaction = validateSunSwapUnsignedTransaction(binding.transaction, binding.intent);
  if (sunSwapUnsignedPayloadHash(transaction) !== operation.quote.unsignedTransactionPayloadHash) mismatch();
  const simulation = binding.simulation;
  if (!isPlainRecord(simulation) || !exactKeys(simulation, ["requestHash", "resultHash", "success", "energyRequired", "feeLimitSun",
    "blockNumber", "blockHash", "headBlockNumber", "maxHeadDrift", "gasEstimate"]) || simulation.success !== true ||
      simulation.requestHash !== operation.quote.simulation.requestHash || simulation.resultHash !== operation.quote.simulation.resultHash ||
      simulation.blockNumber !== operation.quote.simulation.blockNumber || simulation.blockHash !== operation.quote.simulation.blockHash ||
      simulation.headBlockNumber !== operation.quote.simulation.headBlockNumber || simulation.maxHeadDrift !== operation.quote.simulation.maxHeadDrift ||
      simulation.gasEstimate !== operation.quote.simulation.gasEstimate || simulation.energyRequired !== operation.quote.simulation.gasEstimate ||
      simulation.blockHash !== `0x${binding.intent.referenceBlockId}` ||
      simulation.blockNumber !== BigInt(`0x${binding.intent.referenceBlockId.slice(0, 16)}`).toString() ||
      simulation.maxHeadDrift !== SUNSWAP_MAX_HEAD_DRIFT_BLOCKS ||
      simulation.feeLimitSun !== binding.intent.feeLimitSun || BigInt(simulation.energyRequired) > BigInt(binding.intent.maximumEnergy) ||
      BigInt(simulation.energyRequired) * BigInt(binding.intent.energyPriceSun) > BigInt(binding.intent.feeLimitSun)) mismatch();
  const body = { operationId: operation.operationId, ownerProfileHash: operation.ownerProfileHash,
    accountIdentityHash: account.identityHash, quoteHash: operation.quote.quoteHash, routeHash: operation.quote.routeHash,
    providerResponseHash: operation.quote.providerResponseHash, unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash,
    simulationRequestHash: simulation.requestHash, simulationResultHash: simulation.resultHash, policyDigest: operation.policyDigest,
    policyVersion: operation.policyVersion, protocolRegistryDigest: operation.protocolRegistryDigest,
    protocolRegistryVersion: operation.protocolRegistryVersion, mechanismDigest: operation.mechanismDigest,
    txID: transaction.txID, rawDataHex: transaction.raw_data_hex, rawData: transaction.raw_data };
  return domainHash("apn.sunswap-tron-protected-effect.v1", canonicalJson(body));
}

export interface SunSwapSignedTransaction extends SunSwapUnsignedTransaction { readonly signature: readonly [string] }

export function signSunSwapTransaction(transactionValue: unknown, owner: string, seed: Buffer): SunSwapSignedTransaction {
  const transaction = transactionValue as SunSwapUnsignedTransaction;
  tronAddress(owner);
  const bytes = [...seed];
  try {
    if (seed.length !== 32 || tronAddress(utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(bytes))) !== owner) mismatch();
    return validateSunSwapSignedTransaction(utils.crypto.signTransaction(bytes, JSON.parse(canonicalJson(transaction))), transaction, owner);
  } catch { return mismatch(); }
  finally { bytes.fill(0); }
}

export function validateSunSwapSignedTransaction(value: unknown, unsigned: SunSwapUnsignedTransaction, owner: string): SunSwapSignedTransaction {
  if (!isPlainRecord(value) || !exactKeys(value, ["visible", "txID", "raw_data_hex", "raw_data", "signature"]) ||
      value.visible !== false || value.txID !== unsigned.txID || value.raw_data_hex !== unsigned.raw_data_hex ||
      canonicalJson(value.raw_data) !== canonicalJson(unsigned.raw_data) || !Array.isArray(value.signature) ||
      value.signature.length !== 1 || typeof value.signature[0] !== "string" || !/^[a-fA-F0-9]{130}$/u.test(value.signature[0])) mismatch();
  const signature = value.signature[0].toLowerCase();
  try { if (tronAddress(utils.crypto.ecRecover(unsigned.txID, signature)) !== owner) mismatch(); }
  catch { return mismatch(); }
  return { ...unsigned, signature: [signature] };
}

function validateSunSwapEffect(effect: RailSignedEffect, unsigned: SunSwapUnsignedTransaction, owner: string,
  operationId: string, fingerprint: string): SunSwapSignedTransaction {
  if (effect.operationId !== operationId || effect.fingerprint !== fingerprint || effect.transactionId !== unsigned.txID ||
      sha256(effect.rawPayload) !== effect.rawPayloadHash) mismatch();
  let parsed: unknown; try { parsed = JSON.parse(effect.rawPayload); } catch { return mismatch(); }
  const transaction = validateSunSwapSignedTransaction(parsed, unsigned, owner);
  if (canonicalJson(transaction) !== effect.rawPayload) mismatch();
  return transaction;
}

function immutableOperationHash(operation: SwapOperationRecord): string {
  return domainHash("apn.sunswap-tron-operation-binding.v1", canonicalJson({ operationId: operation.operationId,
    ownerProfileHash: operation.ownerProfileHash, quote: operation.quote, policyDigest: operation.policyDigest,
    policyVersion: operation.policyVersion, protocolRegistryDigest: operation.protocolRegistryDigest,
    protocolRegistryVersion: operation.protocolRegistryVersion, mechanismDigest: operation.mechanismDigest,
    approvalCapAtomic: operation.approvalCapAtomic }));
}
function mismatch(): never { throw new ApnError("APN_WALLET_MISMATCH", "SunSwap owner, transaction, signature or protected effect binding does not match the frozen operation."); }
function ambiguous(): never { throw new ApnError("APN_RPC_AMBIGUOUS", "TRON did not acknowledge the exact SunSwap transaction identity; observe only and never resend."); }
