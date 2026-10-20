import type { Permit2AllowanceRecord } from "./model.js";

/** The public projection CLI, MCP and `apn operation status` return; the signed bytes stay in the record. */
export function publicPermit2Allowance(record: Permit2AllowanceRecord): unknown {
  const t = record.terms, observe = `apn x402 permit2 allowance observe --operation ${record.operationId} --rpc-url <https-rpc>`;
  return {
    schema_version: "apn.x402-permit2-allowance-status.v1", kind: record.kind, operation_id: record.operationId, profile: record.profile,
    state: record.state, terminal: record.terminal, action: t.action, chain: `eip155:${t.chainId}`, token: t.token, owner: t.owner, spender: t.spender,
    amount_atomic: t.amountAtomic, prior_allowance_atomic: t.priorAllowanceAtomic, owner_admission: t.admission, proof_tag: t.proofTag,
    nonce: t.nonce, gas_limit: t.gasLimit, max_fee_per_gas_wei: t.maxFeePerGasWei, max_priority_fee_per_gas_wei: t.maxPriorityFeePerGasWei,
    max_native_debit_wei: t.maxNativeDebitWei, transaction_hash: record.signed?.transactionHash ?? null, submitted_at: record.submittedAt,
    outcome: record.outcome, expires_at: t.expiresAt, created_at: record.createdAt, updated_at: record.updatedAt,
    next_actions: record.terminal ? [] : record.state === "prepared" ? [observe]
      : [observe, `apn operation abandon --operation ${record.operationId}`],
  };
}
