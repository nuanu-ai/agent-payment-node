import { approvalCode } from "./approval-code.js";
import { canonicalJson, domainHash } from "./canonical.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2, } from "./asset-policy-registry.js";
import { swapMechanismDigest } from "./swap/pin.js";
import { exactChainConsent, TTY_APPROVAL_DEADLINE_MS } from "./tty-approval.js";
const FINGERPRINT_DOMAIN = "apn.allowlist-policy-decision-fingerprint.v1";
const RAILS = ["direct", "gasless", "x402", "bridge", "swap"];
export function allowlistAdmissions(registry) {
    return registry.chains.flatMap((chain) => chain.assets.flatMap((asset) => RAILS.filter((rail) => asset.rails[rail]).map((rail) => {
        const caps = (registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? asset.railCaps?.[rail] : asset.caps);
        const mechanism = rail === "direct" ? undefined : asset.mechanismPins?.[rail];
        return { network: chain.name, chain: chain.chain, symbol: asset.symbol, kind: asset.kind, identifier: asset.identifier,
            decimals: asset.decimals, rail, maximumPerTransferAtomic: caps.maximumPerTransferAtomic, dailyLimitAtomic: caps.dailyLimitAtomic,
            mechanism: mechanism ?? null,
            ...(rail === "bridge" && asset.mechanismOptions !== undefined ? { mechanismOptions: asset.mechanismOptions.bridge } : {}) };
    })));
}
export function allowlistDecisionFingerprint(input) {
    return domainHash(FINGERPRINT_DOMAIN, canonicalJson(input));
}
export function allowlistDecisionCode(action, fingerprint) {
    return approvalCode(action === "activate" ? "allowlist-activate" : "allowlist-revoke", fingerprint);
}
/** The exact owner screen. Pure, so tests and the scripted transcript show the same text the terminal prints. */
export function allowlistDecisionLines(intent, approvalWindowClosesAt) {
    const { record } = intent;
    const registry = record.registry;
    const admissions = allowlistAdmissions(registry);
    const accounts = ["evm", "solana", "tron"].filter((family) => intent.accounts[family] !== undefined)
        .map((family) => `${family} ${intent.accounts[family]}`).join("; ");
    return [
        intent.action === "activate" ? "Agent Payment Node allowlist policy ACTIVATION" : "Agent Payment Node allowlist policy REVOCATION",
        `Profile: ${intent.profile}`,
        `Revision: ${record.revision} (overlay ${record.overlay.overlayVersion}; staged ${record.preparedAt}; ${record.schemaVersion})`,
        `Currently active revision: ${intent.currentActiveRevision ?? "none"}`,
        intent.action === "activate"
            ? (intent.currentActiveRevision === null ? "Effect: this revision becomes the active policy." : `Effect: this revision replaces active revision ${intent.currentActiveRevision}.`)
            : "Effect: no allowlist policy stays active for this profile; rails that require one refuse.",
        `Owner accounts: ${accounts}`,
        `Frozen dataset: ${record.overlay.datasetVersion} (sha256 ${record.overlay.datasetSha256})`,
        `Effective at: ${registry.effectiveAt ?? `${registry.effectiveDate} (UTC date)`}`,
        `Expires at: ${registry.expiresAt ?? "never (active until revoked)"}`,
        `Admissions: ${admissions.length}`,
        ...admissions.flatMap((row, index) => [
            `${index + 1}. ${row.network} (${row.chain}) ${row.symbol} ${row.kind === "native" ? "native" : `token ${row.identifier}`}; rail ${row.rail}`,
            `   Per operation: ${display(row.maximumPerTransferAtomic, row.decimals)} ${row.symbol} (${row.maximumPerTransferAtomic} atomic, ${row.decimals} decimals)`,
            `   Daily (UTC): ${display(row.dailyLimitAtomic, row.decimals)} ${row.symbol} (${row.dailyLimitAtomic} atomic)`,
            ...(row.mechanism === null ? [] : [`   Mechanism pin: ${mechanismText(row.mechanism)}`]),
            ...(row.mechanismOptions === undefined ? [] : row.mechanismOptions.map((option) => `   Mechanism pin: provider ${option.provider}; reference ${option.reference}; per operation ${display(option.maximumPerTransferAtomic, row.decimals)} ${row.symbol} (${option.maximumPerTransferAtomic} atomic)`)),
        ]),
        "Daily caps count this asset's combined usage on every rail during the UTC day.",
        `Policy digest: ${registry.policyDigest}`,
        `Staged record: ${record.recordDigest}`,
        `Fingerprint: ${intent.fingerprint}`,
        `Approval window closes: ${approvalWindowClosesAt}`,
    ];
}
export class TtyAllowlistPolicyApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(intent) {
        const closesAt = new Date(Date.now() + TTY_APPROVAL_DEADLINE_MS).toISOString();
        await exactChainConsent(allowlistDecisionLines(intent, closesAt), intent.code, closesAt, this.options);
    }
}
function mechanismText(pin) {
    if (!("schemaVersion" in pin))
        return `provider ${pin.provider}; reference ${pin.reference}`;
    return [`swap ${pin.protocolFamily} ${pin.protocolVersion} on ${pin.chain}`, `router ${pin.routerProgramIdentity}`,
        `auxiliary [${pin.auxiliaryContractProgramIdentities.join(", ")}]`,
        `${pin.constructorKind} ${pin.constructorIdentity}@${pin.constructorVersion}`,
        `quote ${pin.quoteSchemaVersion}; transaction ${pin.transactionSchemaVersion}`,
        `validation ${pin.validationPolicyIdentity}@${pin.validationPolicyVersion}`, `pin digest ${swapMechanismDigest(pin)}`].join("; ");
}
function display(atomic, decimals) {
    if (decimals === 0)
        return atomic;
    const text = atomic.padStart(decimals + 1, "0");
    const fraction = text.slice(-decimals).replace(/0+$/u, "");
    return `${text.slice(0, -decimals)}${fraction === "" ? "" : `.${fraction}`}`;
}
//# sourceMappingURL=allowlist-policy-activation.js.map