import { ChainAccountStore } from "../chain-account-store.js";
import { chainDisplay } from "../chain-policy.js";
import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import { SolanaRpcPacer } from "../solana/pacing.js";
import { SolanaRpc, SolanaRpcBudget } from "../solana/rpc.js";
import { StateStore } from "../state.js";
import { EncryptedProfilePolicy } from "../encrypted-profile-policy.js";
import { ApnError } from "../errors.js";
import { HttpsX402Http } from "../x402-http.js";
import type { X402SolanaRecord } from "./model.js";
import type { X402SolanaPorts } from "./service.js";

/**
 * The family's ports. The chain port exists only with an explicit APN_SOLANA_RPC_URL (never the public default other
 * Solana commands may use); without it every chain read refuses, naming that setting.
 */
export function x402SolanaPorts(root: string, options: RuntimeFactoryOptions): X402SolanaPorts {
  const url = options.solanaRpcUrl ?? process.env.APN_SOLANA_RPC_URL;
  const state = new StateStore(root), now = () => options.clock?.now() ?? new Date();
  const rpc = url === undefined || url === "" ? undefined : options.x402SolanaRpc ?? new SolanaRpc(url, options.solanaRpcFetch,
    new SolanaRpcBudget({ maxPhysicalRequests: 32, minimumIntervalMs: 750, ...(options.solanaRpcNow === undefined ? {} : { now: options.solanaRpcNow }),
      wait: options.solanaRpcWait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) }),
    new SolanaRpcPacer(state, options.solanaRpcNow, options.solanaRpcWait));
  const wrapping = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
  // Payments only read the owner's policy; creating or raising it stays `wallet policy set` in the foreground.
  const policy = options.policy ?? new EncryptedProfilePolicy(state, wrapping, { approve: async () => {
    throw new ApnError("APN_INTERNAL", "A Solana x402 payment never changes the owner's policy.");
  } }, options.clock);
  return { accounts: options.chainAccounts ?? new ChainAccountStore(root, wrapping), http: options.http ?? new HttpsX402Http(), now, policy,
    ...(rpc === undefined ? {} : { rpc }) };
}

/** The owner's unknown-effect abandon screen for an exposed payment no proof decides. */
export async function approveX402SolanaAbandon(port: OperationAbandonApprovalPort, record: X402SolanaRecord): Promise<void> {
  const t = record.terms;
  await port.approve({ operationId: record.operationId, fingerprint: record.fingerprint, profile: record.profile, providerId: "local",
    walletAddress: t.payer, recipient: t.payee, amountAtomic: t.amountAtomic, amountDecimal: chainDisplay(t.amountAtomic, t.decimals),
    chainLabel: `Solana mainnet (${t.network})`, assetLabel: `${t.symbol} (${t.mint})`, unit: t.symbol,
    outcomeNote: "The seller's facilitator may have landed this payment before its blockhash lifetime ended; the price stays charged to the owner's daily cap." });
}
