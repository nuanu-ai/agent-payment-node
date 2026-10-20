import { ApnError } from "../errors.js";
import { X402_SOLANA_POLICY_NETWORK } from "../x402-network.js";
import { x402SolanaAccount } from "./signing.js";
/**
 * The owner's profile x402 policy for Solana x402 and one SPL mint, bound to the profile's local Solana wallet: the same
 * encrypted record, command and limits as EVM x402 (`wallet policy set --chain solana:5eykt4… --asset <mint>`), whose
 * `--max-balance-usdc-atomic` is the wallet's balance cap of that mint and `--max-x402-amount-atomic` the per-payment cap.
 */
export async function solanaPolicyBinding(accounts, profile, mint) {
    if (accounts === undefined)
        throw new ApnError("APN_INTERNAL", "The Solana account store is not installed.");
    const account = await x402SolanaAccount(accounts, profile);
    // A Solana base58 address in the field EVM bindings fill with their checksummed address.
    return { profile: account.profile, profileHash: account.profileHash, walletAddress: account.address,
        walletBindingHash: account.identityHash, x402Solana: { mint } };
}
/** Unattended Solana x402 runs only under this policy; a missing one is refused naming the command that sets it. */
export async function requireSolanaPolicy(port, binding) {
    const policy = await port.load(binding);
    if (policy === null) {
        throw new ApnError("APN_WALLET_POLICY_REQUIRED", "Configure the owner's Solana x402 policy for this mint before unattended payments.", {
            reason: "x402_solana_policy_required", chain: X402_SOLANA_POLICY_NETWORK, asset: binding.x402Solana.mint,
            nextActions: [`apn wallet policy set --profile ${binding.profile} --chain ${X402_SOLANA_POLICY_NETWORK} --asset ${binding.x402Solana.mint} ` +
                    "--max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>"]
        });
    }
    return policy;
}
/** The overfunded-wallet guard of unattended x402: the wallet's balance of the mint must not exceed the owner's cap. */
export function assertSolanaUnattendedBalance(policy, balanceAtomic) {
    if (BigInt(balanceAtomic) > BigInt(policy.maxBalanceUsdcAtomic)) {
        throw new ApnError("APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402", "The Solana wallet holds more of this mint than the owner's balance cap; unattended Solana x402 is blocked.", {
            reason: "x402_solana_wallet_overfunded", configured_limit_atomic: policy.maxBalanceUsdcAtomic, balance_atomic: balanceAtomic
        });
    }
}
//# sourceMappingURL=policy.js.map