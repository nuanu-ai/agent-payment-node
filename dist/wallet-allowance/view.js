const selectors = (input) => `--profile ${input.profile} --chain eip155:${input.chainId} --asset ${input.token} --spender ${input.spender}`;
/** The exact revoke command for one residual permission; the gas caps are the owner's own inputs. */
export function walletAllowanceRevokeCommand(input) {
    return `apn wallet allowance revoke ${selectors(input)} --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`;
}
/** The same revoke with its frozen caps: it continues this open revoke and sends its sealed bytes; it never signs again. */
export function walletAllowanceResendCommand(record) {
    const t = record.terms;
    return `apn wallet allowance revoke ${selectors({ profile: record.profile, ...t })} --max-gas-limit ${t.gasLimit} --max-fee-per-gas-wei ${t.maxFeePerGasWei} ` +
        `--max-priority-fee-per-gas-wei ${t.maxPriorityFeePerGasWei}`;
}
/** The read-only allowance read of the same permission. */
export function walletAllowanceStatusCommand(input) { return `apn wallet allowance status ${selectors(input)}`; }
/** The public projection CLI, MCP and `apn operation status` return; the signed bytes stay in the record. */
export function publicWalletAllowanceRevoke(record) {
    const t = record.terms, status = `apn operation status --operation ${record.operationId}`, target = { profile: record.profile, ...t };
    return {
        schema_version: "apn.wallet-allowance-revoke-status.v1", kind: record.kind, operation_id: record.operationId, profile: record.profile,
        state: record.state, terminal: record.terminal, chain: `eip155:${t.chainId}`, token: t.token, owner: t.owner, spender: t.spender,
        new_allowance_atomic: "0", prior_allowance_atomic: t.priorAllowanceAtomic, proof_tag: t.proofTag, rpc_setting: t.rpcSetting, nonce: t.nonce,
        gas_limit: t.gasLimit, max_fee_per_gas_wei: t.maxFeePerGasWei, max_priority_fee_per_gas_wei: t.maxPriorityFeePerGasWei,
        max_native_debit_wei: t.maxNativeDebitWei, transaction_hash: record.signed?.transactionHash ?? null, submitted_at: record.submittedAt,
        outcome: record.outcome, expires_at: t.expiresAt, created_at: record.createdAt, updated_at: record.updatedAt,
        // A revoke that reverted or can never land left the allowance standing: the same revoke again is the owner's next step.
        // An abandoned one may still land, so the allowance is read before anything else. A sealed one no send reached is sent
        // by the same revoke command (its frozen caps), which never signs again.
        next_actions: ["reverted", "superseded"].includes(record.state) ? [walletAllowanceRevokeCommand(target)]
            : record.state === "abandoned_unknown" ? [walletAllowanceStatusCommand(target)]
                : record.terminal ? [] : record.state === "prepared" ? [status]
                    : [...record.state === "signed" ? [walletAllowanceResendCommand(record)] : [status], `apn operation abandon --operation ${record.operationId}`],
    };
}
/** One proof class for the command and `apn operation status`. */
export function walletAllowanceRevokeProofClass(record) {
    if (record.state === "completed" || record.state === "reverted")
        return `receipt_at_${record.terms.proofTag}`;
    if (record.state === "superseded")
        return "finalized_nonce_spent_era_indexed";
    if (record.state === "abandoned_unknown")
        return "owner_acknowledgement_only";
    return "wallet_allowance_revoke_local_journal";
}
//# sourceMappingURL=view.js.map