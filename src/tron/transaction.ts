import { utils } from "tronweb";
import { canonicalJson, exactKeys, sha256 } from "../canonical.js";
import { atomic } from "../chain-policy.js";
import type { RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
import { ApnError } from "../errors.js";
import { TRON_USDT_HEX, tronAddress, tronArray, tronAtomic, tronHash, tronHex, tronProtocolFailure, tronRecord, tronSafeNumber, tronTransferData } from "./codec.js";

interface TronTransactionIntent {
  readonly token: boolean; readonly sender: string; readonly recipient: string; readonly amountAtomic: string;
  readonly blockId: string; readonly timestamp: string; readonly expiration: string; readonly energyFeeLimitAtomic: string;
}
export interface TronTransaction {
  readonly visible: false;
  readonly txID: string;
  readonly raw_data_hex: string;
  readonly raw_data: {
    readonly contract: readonly { readonly type: "TransferContract" | "TriggerSmartContract"; readonly parameter: { readonly type_url: string; readonly value: Readonly<Record<string, unknown>> } }[];
    readonly ref_block_bytes: string; readonly ref_block_hash: string; readonly timestamp: number; readonly expiration: number; readonly fee_limit?: number;
  };
  readonly signature?: readonly string[];
}
export function buildTronTransaction(input: TronTransactionIntent): TronTransaction {
  tronHash(input.blockId); const type = input.token ? "TriggerSmartContract" : "TransferContract";
  const value = input.token ? { owner_address: tronHex(input.sender), contract_address: TRON_USDT_HEX, data: tronTransferData(input.recipient, input.amountAtomic) }
    : { owner_address: tronHex(input.sender), to_address: tronHex(input.recipient), amount: tronSafeNumber(atomic(input.amountAtomic, true)) };
  const raw_data = {
    contract: [{ parameter: { value, type_url: `type.googleapis.com/protocol.${type}` }, type }],
    ref_block_bytes: input.blockId.slice(12, 16), ref_block_hash: input.blockId.slice(16, 32),
    expiration: tronSafeNumber(atomic(input.expiration, true)), timestamp: tronSafeNumber(atomic(input.timestamp, true)),
    ...(input.token ? { fee_limit: tronSafeNumber(atomic(input.energyFeeLimitAtomic, true)) } : {}),
  } as TronTransaction["raw_data"];
  try {
    const pb = utils.transaction.txJsonToPb({ visible: false, raw_data });
    const raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
    const txID = sha256(Buffer.from(raw_data_hex, "hex"));
    if (utils.transaction.txPbToTxID(pb).replace(/^0x/u, "").toLowerCase() !== txID) mismatch();
    return { visible: false, txID, raw_data_hex, raw_data };
  } catch { return mismatch(); }
}
export function unsignedTronPrepared(prepared: RailPreparedTransfer): TronTransaction {
  const snapshot = prepared.resources;
  if (prepared.rail !== "tron" || snapshot === undefined || prepared.unsignedPayload === null) mismatch();
  const expected = buildTronTransaction({ token: prepared.asset.kind === "token", sender: prepared.sender, recipient: prepared.recipient, amountAtomic: prepared.amountAtomic,
    blockId: snapshot.referenceBlockId, timestamp: snapshot.referenceTimestampMsAtomic, expiration: snapshot.expirationMsAtomic, energyFeeLimitAtomic: snapshot.energyFeeLimitAtomic });
  let parsed: unknown; try { parsed = JSON.parse(prepared.unsignedPayload); } catch { return mismatch(); }
  if (canonicalJson(expected) !== canonicalJson(parsed) || prepared.unsignedPayload !== canonicalJson(parsed) || expected.raw_data_hex.length / 2 !== Number(snapshot.rawDataBytesAtomic)) mismatch();
  return expected;
}
export function validateTronChainTransaction(value: unknown, prepared: RailPreparedTransfer): TronTransaction {
  const expected = unsignedTronPrepared(prepared); const record = tronRecord(value);
  if (Object.keys(record).some((key) => !["visible", "txID", "raw_data_hex", "raw_data", "signature", "ret"].includes(key)) || record.visible !== undefined && record.visible !== false || record.txID !== expected.txID || record.raw_data_hex !== expected.raw_data_hex) mismatch();
  const raw = tronRecord(record.raw_data);
  const allowed = ["contract", "ref_block_bytes", "ref_block_hash", "expiration", "timestamp", "fee_limit", "data"];
  if (Object.keys(raw).some((key) => !allowed.includes(key)) || raw.data !== undefined && raw.data !== "") mismatch();
  const contracts = tronArray(raw.contract, 1); if (contracts.length !== 1) mismatch();
  const contract = tronRecord(contracts[0]);
  if (Object.keys(contract).some((key) => !["type", "parameter", "Permission_id"].includes(key)) || tronAtomic(contract.Permission_id, true) !== 0n) mismatch();
  const parameter = tronRecord(contract.parameter);
  if (!exactKeys(parameter, ["type_url", "value"])) mismatch();
  const parameters = tronRecord(parameter.value);
  const keys = prepared.asset.kind === "native" ? ["owner_address", "to_address", "amount"] : ["owner_address", "contract_address", "data", "call_value", "call_token_value", "token_id"];
  if (Object.keys(parameters).some((key) => !keys.includes(key)) || typeof parameters.owner_address !== "string") mismatch();
  const normalized: Record<string, unknown> = { owner_address: tronHex(parameters.owner_address) };
  if (prepared.asset.kind === "native") {
    if (typeof parameters.to_address !== "string") mismatch();
    normalized.to_address = tronHex(parameters.to_address); normalized.amount = tronSafeNumber(tronAtomic(parameters.amount));
  } else {
    if (typeof parameters.contract_address !== "string" || typeof parameters.data !== "string") mismatch();
    for (const key of ["call_value", "call_token_value", "token_id"]) if (tronAtomic(parameters[key], true) !== 0n) mismatch();
    normalized.contract_address = tronHex(parameters.contract_address); normalized.data = parameters.data;
  }
  const fee = tronAtomic(raw.fee_limit, true);
  const normalizedRaw = { contract: [{ type: contract.type, parameter: { type_url: parameter.type_url, value: normalized } }],
    ref_block_bytes: raw.ref_block_bytes, ref_block_hash: raw.ref_block_hash, expiration: tronSafeNumber(tronAtomic(raw.expiration)), timestamp: tronSafeNumber(tronAtomic(raw.timestamp)),
    ...(fee > 0n ? { fee_limit: tronSafeNumber(fee) } : {}),
  };
  if (canonicalJson(normalizedRaw) !== canonicalJson(expected.raw_data)) mismatch();
  const signatures = tronArray(record.signature, 1); if (signatures.length !== 1 || typeof signatures[0] !== "string" || !/^[a-fA-F0-9]{130}$/u.test(signatures[0])) mismatch();
  const signature = signatures[0].toLowerCase();
  try {
    if (tronAddress(utils.crypto.ecRecover(expected.txID, signature)) !== prepared.sender) mismatch();
    if (utils.transaction.txPbToRawDataHex(utils.transaction.txJsonToPb({ visible: false, raw_data: normalizedRaw })).toLowerCase() !== expected.raw_data_hex) mismatch();
  } catch { return mismatch(); }
  return { ...expected, signature: [signature] };
}
export function validateTronEffect(prepared: RailPreparedTransfer, effect: RailSignedEffect): TronTransaction {
  if (sha256(effect.rawPayload) !== effect.rawPayloadHash) mismatch();
  let value: unknown; try { value = JSON.parse(effect.rawPayload); } catch { return mismatch(); }
  const transaction = validateTronChainTransaction(value, prepared);
  if (effect.transactionId !== transaction.txID || canonicalJson(transaction) !== effect.rawPayload) mismatch();
  return transaction;
}
export function signTronTransaction(prepared: RailPreparedTransfer, seed: Buffer): TronTransaction {
  const unsigned = unsignedTronPrepared(prepared);
  const bytes = [...seed];
  try {
    if (seed.length !== 32 || tronAddress(utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(bytes))) !== prepared.sender) mismatch();
    const signed = utils.crypto.signTransaction(bytes, JSON.parse(canonicalJson(unsigned)));
    return validateTronChainTransaction(signed, prepared);
  } catch { return mismatch(); } finally { bytes.fill(0); }
}
function mismatch(): never { throw new ApnError("APN_WALLET_MISMATCH", "TRON protobuf, transaction identity or signature does not match the frozen payment."); }
