import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { UniswapTokenExecution } from "./token-execution.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
export class InstalledUniswapTokenRuntime {
    builder;
    materials;
    journal;
    ports;
    execution;
    constructor(builder, materials, journal, ports) {
        this.builder = builder;
        this.materials = materials;
        this.journal = journal;
        this.ports = ports;
        this.execution = new UniswapTokenExecution(journal, ports);
    }
    inventory() { return this.builder.inventory(); }
    async quote(request) { return await this.builder.quote(request); }
    async prepare(request) {
        const material = await this.materials.load(request.quoteHash);
        if (material === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared Uniswap token quote was not found.");
        if (material.profile !== request.profile || material.mechanismDigest !== swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN))
            blocked("Token quote binding changed.", "uniswap_token_quote_binding");
        if (this.ports.now().getTime() >= material.route.deadline * 1000)
            blocked("Token quote expired.", "uniswap_token_quote_expired");
        await this.ports.confirm(material);
        const operationId = domainHash("apn.uniswap-token-operation-id.v1", canonicalJson({ profile: request.profile,
            quoteHash: request.quoteHash, idempotencyKey: request.idempotencyKey }));
        const prior = await this.journal.load(operationId);
        if (prior !== null)
            return prior;
        return await this.journal.save(newUniswapTokenOperation({ operationId, profile: material.profile, account: material.account,
            route: material.route, approvalCapAtomic: material.approvalCapAtomic, allowanceAtPrepare: material.allowanceAtPrepare,
            approvalGas: material.approvalGas, swapGas: material.swapGas, cleanupGas: material.cleanupGas,
            maximumNativeDebitWei: material.maximumNativeDebitWei, policyDigest: material.policyDigest,
            mechanismDigest: material.mechanismDigest, now: this.ports.now() }));
    }
    async approve(id) { return await this.execution.approve(id); }
    async execute(id) { return await this.execution.execute(id); }
    async status(id) { return await this.execution.status(id); }
    async cleanup(id) { return await this.execution.cleanup(id); }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-runtime.js.map