import { canonicalJson, domainHash } from "../../canonical.js";
import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import type { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { UniswapTokenExecution, type UniswapTokenCommandRuntime, type UniswapTokenExecutionPorts } from "./token-execution.js";
import type { SavedUniswapTokenMaterialStore, UniswapTokenMaterial } from "./token-material.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
type Prepare = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.prepare";
}>;
export interface UniswapTokenRuntimePorts extends UniswapTokenExecutionPorts {
    confirm(material: UniswapTokenMaterial): Promise<void>;
}
export class InstalledUniswapTokenRuntime implements UniswapTokenCommandRuntime {
    private readonly execution: UniswapTokenExecution;
    constructor(private readonly builder: UniswapTokenQuoteBuilder, private readonly materials: SavedUniswapTokenMaterialStore, private readonly journal: UniswapTokenJournal, private readonly ports: UniswapTokenRuntimePorts) { this.execution = new UniswapTokenExecution(journal, ports); }
    inventory() { return this.builder.inventory(); }
    async quote(request: Extract<CommandRequest, {
        readonly command: "swap.uniswap-token.quote";
    }>) { return await this.builder.quote(request); }
    async prepare(request: Prepare) {
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
    async approve(id: string) { return await this.execution.approve(id); }
    async execute(id: string) { return await this.execution.execute(id); }
    async status(id: string) { return await this.execution.status(id); }
    async cleanup(id: string) { return await this.execution.cleanup(id); }
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
