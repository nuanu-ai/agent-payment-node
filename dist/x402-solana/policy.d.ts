import type { ChainWalletStoragePort } from "../direct-rail-ports.js";
import type { ProfilePolicyBinding, ProfilePolicyPort, ProfilePolicyRecord } from "../profile-policy.js";
/**
 * The owner's profile x402 policy for Solana x402 and one SPL mint, bound to the profile's local Solana wallet: the same
 * encrypted record, command and limits as EVM x402 (`wallet policy set --chain solana:5eykt4… --asset <mint>`), whose
 * `--max-balance-usdc-atomic` is the wallet's balance cap of that mint and `--max-x402-amount-atomic` the per-payment cap.
 */
export declare function solanaPolicyBinding(accounts: ChainWalletStoragePort | undefined, profile: string, mint: string): Promise<ProfilePolicyBinding>;
/** Unattended Solana x402 runs only under this policy; a missing one is refused naming the command that sets it. */
export declare function requireSolanaPolicy(port: ProfilePolicyPort, binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord>;
/** The overfunded-wallet guard of unattended x402: the wallet's balance of the mint must not exceed the owner's cap. */
export declare function assertSolanaUnattendedBalance(policy: ProfilePolicyRecord, balanceAtomic: string): void;
