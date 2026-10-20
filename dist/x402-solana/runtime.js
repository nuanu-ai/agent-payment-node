import { approvalCode } from "../approval-code.js";
import { ChainAccountStore } from "../chain-account-store.js";
import { chainDecimal } from "../chain-policy.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import { SolanaRpcPacer } from "../solana/pacing.js";
import { SolanaRpc, SolanaRpcBudget } from "../solana/rpc.js";
import { StateStore } from "../state.js";
import { exactChainConsent } from "../tty-approval.js";
import { HttpsX402Http } from "../x402-http.js";
/**
 * The family's ports. The chain port exists only with an explicit APN_SOLANA_RPC_URL (never the public default other
 * Solana commands may use); without it every chain read refuses, naming that setting.
 */
export function x402SolanaPorts(root, options, foreground) {
    const url = options.solanaRpcUrl ?? process.env.APN_SOLANA_RPC_URL;
    const state = new StateStore(root), now = () => options.clock?.now() ?? new Date();
    const rpc = url === undefined || url === "" ? undefined : options.x402SolanaRpc ?? new SolanaRpc(url, options.solanaRpcFetch, new SolanaRpcBudget({ maxPhysicalRequests: 32, minimumIntervalMs: 750, ...(options.solanaRpcNow === undefined ? {} : { now: options.solanaRpcNow }),
        wait: options.solanaRpcWait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) }), new SolanaRpcPacer(state, options.solanaRpcNow, options.solanaRpcWait));
    return { accounts: options.chainAccounts ?? new ChainAccountStore(root, options.wrappingSecret ?? new MacOSLoginKeychainSecret()),
        http: options.http ?? new HttpsX402Http(), now, ...(rpc === undefined ? {} : { rpc }),
        ...(foreground ? { consent: async (record) => await x402SolanaConsent(record, options) } : {}) };
}
async function x402SolanaConsent(record, options) {
    const t = record.terms;
    await exactChainConsent([
        "Agent Payment Node x402 Solana exact payment", `Operation: ${record.operationId}`, `Profile: ${record.profile}; local payer: ${t.payer}`,
        `GET ${t.url}`, `Network: ${t.network} (Solana mainnet)`, `Mint: ${t.symbol} ${t.mint} (${t.decimals} decimals)`,
        `Exact price: ${t.amountAtomic} atomic (${chainDecimal(t.amountAtomic, t.decimals)} ${t.symbol}); explicit maximum ${t.maxAmountAtomic} atomic`,
        `Payee: ${t.payee} (token account ${t.destinationTokenAccount})`, `Fee payer (the seller's facilitator): ${t.feePayer}`,
        `Transaction: SetComputeUnitLimit ${t.computeUnitLimit}, SetComputeUnitPrice ${t.computeUnitPriceMicroLamports} micro-lamports, ` +
            "one SPL TransferChecked from your token account; nothing else",
        `Owner policy: ${t.admission.policyDigest}; revision ${t.admission.policyRevision}; per-payment cap ${t.admission.maximumPerTransferAtomic}; ` +
            `daily cap ${t.admission.dailyLimitAtomic}`,
        `Offer: index ${t.offerIndex}, hash ${t.offerHash}; challenge ${t.challengeHash}`, `Fingerprint: ${record.fingerprint}`,
        `Approval window ends: ${t.expiresAt}`,
        "One transaction is signed and one paid request is sent. An unknown outcome is held for observation and never sent again.",
    ], x402SolanaApprovalPhrase(record), t.expiresAt, options.x402SolanaTtyOptions ?? {});
}
export function x402SolanaApprovalPhrase(record) {
    return approvalCode("transfer", "x402-solana.v1", record.fingerprint);
}
/** The owner's unknown-effect abandon screen for an exposed payment no proof decides. */
export async function approveX402SolanaAbandon(port, record) {
    const t = record.terms;
    await port.approve({ operationId: record.operationId, fingerprint: record.fingerprint, profile: record.profile, providerId: "local",
        walletAddress: t.payer, recipient: t.payee, amountAtomic: t.amountAtomic, amountDecimal: chainDecimal(t.amountAtomic, t.decimals),
        chainLabel: `Solana mainnet (${t.network})`, assetLabel: `${t.symbol} (${t.mint})`, unit: t.symbol,
        outcomeNote: "The seller's facilitator may have landed this payment before its blockhash lifetime ended; the price stays charged to the owner's daily cap." });
}
//# sourceMappingURL=runtime.js.map