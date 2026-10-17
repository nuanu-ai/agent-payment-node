import { address, getBase64EncodedWireTransaction, getPublicKeyFromAddress, getSignatureFromTransaction, getTransactionDecoder, verifySignature } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { solanaSignature } from "../../solana/rpc.js";
import { sha256Hex } from "../../swap/orca-solana/pins.js";
import { validateOrcaStableUnsigned } from "./preview.js";
import { validateStableSourceBinding } from "./source-binding.js";
const VERSION = "apn.orca-stable-execution-binding.v2";
/** Frozen reader of the execution binding a released stable execution wrote after its marker. */
export class OrcaStableExecutionBindingStore extends SecureStateStore {
    initialized;
    async load(operation, material) {
        await this.ready();
        const raw = await this.readJson(this.path(operation));
        if (raw === null)
            return null;
        const value = raw;
        const { bindingHash, ...body } = value;
        if (bindingHash !== domainHash(VERSION, canonicalJson(body)) ||
            value.schemaVersion !== VERSION || value.operationId !== operation.operationId ||
            value.operationIntegrityHash !== operation.submissionMarker?.operationIntegrityHash ||
            value.submissionMarkerHash !== operation.submissionMarker?.markerHash ||
            value.materialDigest !== material.materialDigest || value.policyDigest !== material.policyDigest ||
            value.activationDigest !== material.activationDigest ||
            canonicalJson(validateStableSourceBinding(value.sourceBinding)) !== canonicalJson(material.sourceBinding) ||
            value.preview.owner !== operation.quote.account ||
            value.preview.amountInAtomic !== operation.quote.inputAmountAtomic ||
            value.preview.minimumOutputAtomic !== operation.quote.minimumOutputAtomic)
            corrupt("Stable execution binding is invalid.");
        await validateOrcaStableUnsigned(value.preview);
        return value;
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "stable binding profile");
        stateIdentifier(operation.operationId, "stable binding operation");
        return `orca-stable-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-execution-bindings"); })();
        await this.initialized;
    }
}
export async function verifyOrcaStableSignedEffect(effect, binding) {
    try {
        const bytes = Buffer.from(effect.rawPayload, "base64"), wire = getTransactionDecoder().decode(bytes);
        const signature = wire.signatures[address(binding.preview.owner)];
        if (bytes.toString("base64") !== effect.rawPayload || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
            effect.fingerprint !== binding.bindingHash || effect.operationId !== binding.operationId ||
            Object.keys(wire.signatures).length !== 1 || signature === undefined || signature === null ||
            sha256Hex(new Uint8Array(wire.messageBytes)) !== binding.preview.messageHash ||
            Buffer.from(wire.messageBytes).toString("base64") !== binding.preview.messageBase64 ||
            getBase64EncodedWireTransaction(wire) !== effect.rawPayload ||
            getSignatureFromTransaction(wire) !== solanaSignature(effect.transactionId) ||
            !await verifySignature(await getPublicKeyFromAddress(address(binding.preview.owner)), signature, wire.messageBytes))
            throw new Error();
    }
    catch {
        corrupt("Stable signed effect does not bind the exact owner and message.");
    }
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=execution-binding.js.map