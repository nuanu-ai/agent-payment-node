export function providerX402SettledWithoutResultProof(
  evidence: { readonly schemaVersion: string } | undefined,
): "confirmed_settlement_without_seller_result" | "confirmed_exact_transaction_settlement_without_seller_result" {
  return evidence?.schemaVersion === "apn.provider-x402.transaction-settlement.v1"
    ? "confirmed_exact_transaction_settlement_without_seller_result"
    : "confirmed_settlement_without_seller_result";
}
