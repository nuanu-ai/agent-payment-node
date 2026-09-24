import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateUsdtBoundOperation } from "./bound-operation.js";
import { UsdtExecutionJournal, usdtExecutionIntent } from "./execution-journal.js";
import { verifySignedUsdtOperation } from "./local-signing.js";
/** One effect attempt. A persisted submitting marker prevents any later call from sending again. */
export class GuardedUsdtSendService {
    journal;
    signer;
    transport;
    port;
    constructor(journal, signer, transport, port) {
        this.journal = journal;
        this.signer = signer;
        this.transport = transport;
        this.port = port;
    }
    async send(value, identity) {
        const bound = validateUsdtBoundOperation(value);
        if (identity.profile !== bound.binding.profile || identity.profileHash !== bound.profileHash ||
            identity.operationId !== bound.operationId || identity.bindingHash !== bound.binding.bindingHash) {
            throw new ApnError("APN_WALLET_MISMATCH", "Gasless USDT sender identity changed.", { rail: "gasless_usdt" });
        }
        const reserved = await this.journal.reserve(bound, usdtExecutionIntent(bound), this.port);
        if (reserved.state !== "reserved") {
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT send was already attempted.", { rail: "gasless_usdt" });
        }
        const signed = await this.signer.sign(bound, identity);
        const { materialHash: _materialHash, ...material } = signed;
        if (signed.operationId !== bound.operationId || signed.profileHash !== bound.profileHash ||
            signed.bindingHash !== bound.binding.bindingHash || signed.materialHash !== hashObject(material) ||
            signed.userOperationHash !== await verifySignedUsdtOperation(bound, signed.userOperation)) {
            throw new ApnError("APN_STATE_CORRUPT", "Gasless USDT signed material changed.", { rail: "gasless_usdt" });
        }
        // The journal rechecks current policy, common usage, canonical safe account, nonce, fees and expiry.
        // Its fsynced transition is the last action before the one permitted network call.
        await this.journal.markSubmitting(bound, this.port, signed.userOperationHash);
        let response;
        try {
            response = await this.transport.send(signed.userOperation);
        }
        catch {
            return await this.journal.markUnknownFinality(bound, this.port.now());
        }
        if (response !== signed.userOperationHash) {
            return await this.journal.markUnknownFinality(bound, this.port.now());
        }
        return await this.journal.markSubmitted(bound, response, this.port.now());
    }
}
//# sourceMappingURL=send.js.map