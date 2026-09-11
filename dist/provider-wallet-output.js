import { CHAIN_CAIP2, BASE_USDC, ETH_DECIMALS, USDC_DECIMALS } from "./constants.js";
import { formatAtomic, parseAtomic } from "./money.js";
import { publicProvenance } from "./wallet-policy.js";
export function permissionBalance(profile, bound, permission, owner, session) {
    const balances = (snapshot) => ({
        ETH: { atomic: snapshot.ethAtomic, decimal: formatAtomic(snapshot.ethAtomic, ETH_DECIMALS), decimals: ETH_DECIMALS },
        USDC: {
            atomic: snapshot.usdcAtomic,
            decimal: formatAtomic(snapshot.usdcAtomic, USDC_DECIMALS),
            decimals: USDC_DECIMALS,
            contract: BASE_USDC,
        },
    });
    return {
        profile,
        provider: bound.provider_id,
        revision: bound.revision,
        capability_hash: bound.capability_hash,
        status: permission.state,
        funding_address: permission.owner_address,
        explorer_url: `https://basescan.org/address/${permission.owner_address}`,
        chain: CHAIN_CAIP2,
        proof_class: "chain_verified_public_read",
        balances: balances(owner),
        provenance: publicProvenance(owner),
        accounts: {
            owner_smart_account: {
                address: permission.owner_address,
                role: "funding_and_usdc_owner",
                balances: balances(owner),
                provenance: publicProvenance(owner),
            },
            session_execution_account: {
                address: permission.session_address,
                role: "delegated_execution_and_gas",
                balances: balances(session),
                provenance: publicProvenance(session),
                gas_readiness: parseAtomic(session.ethAtomic) === 0n
                    ? "not_ready_zero_balance"
                    : "unverified_sufficiency_nonzero",
            },
        },
        funding_guidance: {
            action: `Manually send only Base USDC to owner Smart Account ${permission.owner_address}; future delegated execution also requires Base ETH at session ${permission.session_address}.`,
            warning: "This read performs no funding action and does not prove future effect availability or gas sufficiency.",
        },
        next_actions: permission.state === "active"
            ? ["Fund manually only if intended", "Re-run apn wallet balance"]
            : ["Review the permission lifecycle state before any future effect."],
    };
}
export function publicProfile(profile, reused) {
    const rebindCommand = `apn wallet connect --profile ${profile.profile} --provider ${profile.provider_id} --expected-revision ${profile.revision}`;
    return {
        profile: profile.profile,
        provider: profile.provider_id,
        status: profile.drift.state,
        address: profile.public_address,
        account_binding_hash: profile.account_binding_hash,
        trust_class: profile.trust_class,
        revision: profile.revision,
        capability_hash: profile.capability_hash,
        observed_at: profile.observed_at,
        reused,
        proof_class: "provider_profile_binding",
        ...(profile.drift.state === "bound" ? {
            funding_guidance: {
                network: "Base",
                asset: "USDC",
                address: profile.public_address,
                action: "Fund manually only; APN performs no funding action.",
            },
            next_actions: ["Use apn wallet balance with an explicit Base RPC URL"],
        } : {
            next_actions: [rebindCommand],
        }),
    };
}
//# sourceMappingURL=provider-wallet-output.js.map