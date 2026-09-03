export function publicPermissionProfile(profile, permission, reused) {
    const state = profile.drift.state === "bound" ? permission.state : "drift_blocked";
    return {
        profile: profile.profile,
        provider: profile.provider_id,
        status: state,
        address: permission.owner_address,
        account_binding_hash: profile.account_binding_hash,
        trust_class: profile.trust_class,
        revision: permission.revision,
        capability_hash: profile.capability_hash,
        capabilities: profile.capability_snapshot,
        observed_at: permission.observed_at,
        reused,
        proof_class: "provider_permission_binding",
        permission: {
            protocol: "erc7715",
            owner_smart_account: permission.owner_address,
            session_account: permission.session_address,
            requested_cap_usdc_atomic: permission.requested_cap_atomic,
            granted_cap_usdc_atomic: permission.granted_cap_atomic,
            starts_at_unix: permission.starts_at_unix,
            expires_at_unix: permission.expires_at_unix,
            state,
            revision: permission.revision,
            grant_fingerprint: permission.grant_fingerprint,
            revocation_freshness: permission.revocation_freshness,
            ...(permission.last_foreground_sync_at === undefined ? {} : {
                last_foreground_sync_at: permission.last_foreground_sync_at,
            }),
            owner_custody: "external_metamask",
            session_custody: "encrypted_local_apn",
            provider_revoke: "unavailable_unproved",
        },
        ...(state === "active" ? { funding_guidance: {
                network: "Base",
                asset: "USDC",
                address: permission.owner_address,
                action: "Fund the owner Smart Account manually only; APN performs no funding action.",
                session_gas_address: permission.session_address,
            } } : {}),
        next_actions: permissionNextActions(profile.profile, { ...permission, state }),
    };
}
function permissionNextActions(profile, permission) {
    if (permission.state === "active") {
        return [
            `Use apn wallet balance --profile ${profile} with an explicit Base RPC URL`,
            `Use apn wallet permission sync --profile ${profile} --expected-revision ${permission.revision} for foreground provider freshness`,
        ];
    }
    if (permission.state === "disabled") {
        return ["Create a new profile and foreground permission identity to regain authority."];
    }
    if (permission.state === "expired") {
        return ["Create a new profile and foreground permission identity with a new explicit expiry."];
    }
    if (permission.state === "revoked") {
        return ["Create a new profile and foreground permission identity after reviewing MetaMask grants."];
    }
    return ["Review the selected MetaMask account and permission, then create a new foreground identity."];
}
//# sourceMappingURL=provider-permission-output.js.map