import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import type { X402AuthorizationState } from "./ports.js";
import { validX402Tuple } from "./x402-network.js";
import type { Eip3009StateSettlementEvidence, X402OperationRecord } from "./x402-state-model.js";
import { allowedRecord, bytes32, exactRecord, hash, positive, stateCorrupt, timestamp, transactionHash } from "./x402-state-validation-primitives.js";

const SETTLEMENT_V2 = "apn.x402.settlement-evidence.v2" as const;

/** Settlement read from the nonce state at a safe block; `transaction` is attached only after its receipt matched. */
export function stateSettlementEvidence(
  operation: X402OperationRecord,
  state: X402AuthorizationState & { readonly value: true; readonly blockTag: "safe" },
  rpcOrigin: string,
  transaction?: { readonly transactionHash: `0x${string}`; readonly blockNumber: string; readonly blockHash: `0x${string}` },
): Eip3009StateSettlementEvidence {
  const body = {
    schemaVersion: SETTLEMENT_V2,
    network: operation.network,
    chainId: operation.chainId,
    token: operation.token,
    safeHead: { number: state.blockNumber, hash: state.blockHash, observedAt: state.observedAt },
    authorizationState: { value: true as const, blockNumber: state.blockNumber, blockHash: state.blockHash, blockTag: "safe" as const, observedAt: state.observedAt },
    ...(transaction === undefined ? {} : {
      transactionHash: transaction.transactionHash,
      transactionBlock: { number: transaction.blockNumber, hash: transaction.blockHash },
    }),
    rpcOriginHash: sha256(rpcOrigin),
  };
  return { ...body, evidenceHash: domainHash(SETTLEMENT_V2, canonicalJson(body)) };
}

export function validateStateSettlementEvidence(value: unknown, operation?: Record<string, unknown>): Eip3009StateSettlementEvidence {
  const evidence = allowedRecord(value, ["schemaVersion", "network", "chainId", "token", "safeHead", "authorizationState", "rpcOriginHash", "evidenceHash"],
    ["transactionHash", "transactionBlock"]);
  if (evidence.schemaVersion !== SETTLEMENT_V2 || !validX402Tuple(evidence.chainId, evidence.network, evidence.token) ||
    (operation !== undefined && (operation.chainId !== evidence.chainId || operation.network !== evidence.network || operation.token !== evidence.token))) {
    stateCorrupt("x402 state settlement evidence discriminant is invalid.");
  }
  const safe = exactRecord(evidence.safeHead, ["number", "hash", "observedAt"]);
  positive(safe.number); bytes32(safe.hash); timestamp(safe.observedAt);
  const state = exactRecord(evidence.authorizationState, ["value", "blockNumber", "blockHash", "blockTag", "observedAt"]);
  if (state.value !== true || state.blockTag !== "safe" || state.blockNumber !== safe.number || state.blockHash !== safe.hash ||
    state.observedAt !== safe.observedAt) stateCorrupt("x402 state settlement does not bind its safe block.");
  if ((evidence.transactionHash === undefined) !== (evidence.transactionBlock === undefined)) stateCorrupt("x402 state settlement transaction is partial.");
  if (evidence.transactionHash !== undefined) {
    transactionHash(evidence.transactionHash);
    const block = exactRecord(evidence.transactionBlock, ["number", "hash"]);
    positive(block.number); bytes32(block.hash);
    if (BigInt(block.number as string) > BigInt(safe.number as string) || (block.number === safe.number && block.hash !== safe.hash)) {
      stateCorrupt("x402 state settlement transaction is outside its safe block.");
    }
  }
  hash(evidence.rpcOriginHash); hash(evidence.evidenceHash);
  const { evidenceHash: _hash, ...body } = evidence;
  if (evidence.evidenceHash !== domainHash(SETTLEMENT_V2, canonicalJson(body))) stateCorrupt("x402 state settlement evidence hash is invalid.");
  return evidence as unknown as Eip3009StateSettlementEvidence;
}
