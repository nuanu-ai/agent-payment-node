export function providerX402SettledWithoutResultProof(evidence) {
    return evidence?.schemaVersion === "apn.provider-x402.transaction-settlement.v1"
        ? "confirmed_exact_transaction_settlement_without_seller_result"
        : "confirmed_settlement_without_seller_result";
}
//# sourceMappingURL=provider-x402-proof.js.map