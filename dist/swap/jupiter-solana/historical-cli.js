import { randomUUID } from "node:crypto";
import { OUTPUT_VERSION } from "../../constants.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
const PATH = ["swap", "solana", "jupiter", "historical-authenticate"];
const COMMAND = "swap.solana.jupiter.historical-authenticate";
const PUBLIC_FIELDS = ["schemaVersion", "operationId", "operationIntegrityHash", "rootBinding",
    "ownerProfileHash", "accountBindingHash", "payer", "policyDigest", "activationDigest", "originalBindingHash",
    "originalMaterialDigest", "freshMaterialDigest", "markerHash", "principalLamports", "maximumNativeExpenseLamports",
    "freshMaximumNativeExpenseLamports", "networkFeeLamports", "tokenAccountRentLamports", "genesis", "blockhash",
    "lastValidBlockHeight", "signature", "rawPayloadHash", "messageHash", "freshBlockhash", "freshLastValidBlockHeight",
    "heightBinding", "originalQuoteRpcLifetime", "lifetimeProvenance", "ordinaryRecentBlockhash", "authenticatedAt",
    "authenticationExpiresAt"];
/** This route is deliberately absent from the command catalog, SDK and MCP projection. */
export function isHistoricalJupiterCli(argv) {
    return PATH.every((part, index) => argv[index] === part);
}
/** Only the fixed authenticator can issue and consume authority; the CLI never exports it. */
export async function executeHistoricalJupiterCli(argv, stateRoot) {
    const requestId = randomUUID();
    const base = { version: OUTPUT_VERSION, request_id: requestId, command: COMMAND,
        operation: null, receipt: null, next_actions: [] };
    if (!isHistoricalJupiterCli(argv) || argv.length !== 6 || argv[4] !== "--operation" ||
        !HISTORICAL_JUPITER_IDS.some(id => id === argv[5])) {
        return { ...base, ok: false, proof_class: "classified_failure", data: null,
            error: { code: "APN_INVALID_INPUT", message: "Specify exactly one admitted historical Jupiter operation." } };
    }
    try {
        const root = stateRoot();
        const { JupiterHistoricalAuthenticator } = await import("./historical-authenticator.js");
        const { MacOSLoginKeychainSecret } = await import("../../macos-keychain.js");
        const authenticator = new JupiterHistoricalAuthenticator(root, new MacOSLoginKeychainSecret());
        const { authority } = await authenticator.authenticate(argv[5]);
        const projection = await authenticator.consume(authority, argv[5]);
        const publicProjection = Object.fromEntries(PUBLIC_FIELDS.map(key => [key, projection[key]]));
        if (projection.originalQuoteRpcLifetime !== null) {
            const lifetime = projection.originalQuoteRpcLifetime;
            publicProjection.originalQuoteRpcLifetime = { source: lifetime.source, rpcOriginHash: lifetime.rpcOriginHash,
                contextSlot: lifetime.contextSlot, minimumContextSlot: lifetime.minimumContextSlot,
                blockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight };
        }
        return { ...base, ok: true, proof_class: "historical_material_authentication_only", error: null,
            data: { scope: "Retained material authentication only; no expiry or historical execution verdict, ledger change, or financial permission.",
                projection: publicProjection } };
    }
    catch {
        // No underlying keychain, filesystem, wallet, wire or cryptographic exception crosses this boundary.
        return { ...base, ok: false, proof_class: "classified_failure", data: null,
            error: { code: "APN_OPERATION_BLOCKED", message: "Historical Jupiter material authentication is unavailable." } };
    }
}
//# sourceMappingURL=historical-cli.js.map