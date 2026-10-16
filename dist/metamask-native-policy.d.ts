/**
 * The MetaMask Agent Wallet Guard policy, read for its meaning (owner decision OD-4), never compared byte for byte with
 * one owner's template. Before a native transfer the vendor policy must (1) name the paying wallet, (2) allowlist the
 * operation's recipient for the operation's chain and (3) carry an outflow limit. Other sections (protocol lists, other
 * chains, labels) do not matter here; the vendor enforces them itself.
 *
 * The policy is YAML. This reader takes only the block subset the vendor writes (mappings, sequences, plain, quoted and
 * numeric scalars, comments) and refuses anything else (anchors, tags, multi-line scalars, flow collections other than
 * `[]`/`{}`), so a policy it cannot read exactly is refused, never guessed.
 */
export interface MetaMaskGuardPolicyAdmission {
    /** Each outflow limit as the vendor policy states it, in USD, e.g. `{ rolling_24h: "0.5" }`. */
    readonly outflowLimitsUsd: Readonly<Record<string, string>>;
}
/** Refuses, with a reason the owner can act on, unless the policy admits this exact payer, chain and recipient. */
export declare function metaMaskGuardPolicyAdmits(policy: string, expected: {
    readonly payer: string;
    readonly chainId: number;
    readonly recipient: string;
}): MetaMaskGuardPolicyAdmission;
