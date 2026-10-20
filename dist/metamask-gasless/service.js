import { mmObservationRpcEnv } from "./chain/rpc.js";
import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { MetaMaskGaslessExecution } from "./execution.js";
import { MetaMaskGaslessOperationRepository } from "./journal/repository.js";
import { liveMetaMaskGaslessOperation, publicMetaMaskGaslessOperation } from "./journal/receipt.js";
import { advanceMetaMaskGaslessOperation } from "./journal/transitions.js";
import { MetaMaskGaslessObservationService } from "./observation.js";
import { metaMaskGaslessOwner } from "./owner.js";
import { MetaMaskGaslessPreparation } from "./prepare.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmChain } from "./validation.js";
import { revokeMetaMaskGasless } from "./revocation/service.js";
import { canonicalProfile } from "../wallet-policy.js";
import { directEvmNetwork } from "../evm-direct-networks.js";
import { formatAtomic } from "../money.js";
/**
 * Next actions follow only what the refusal proves (METAMASK-FEE-REFUSAL-ASSET-GUIDANCE-001): the native gas shortfall
 * MetaMask's own simulation states, APN's own USDC balance read below the transfer plus its fee, or no proven cause.
 * USDC is named as short only on APN's read; no native transfer or other relay stands in for this one.
 */
function feeQuoteGuidance(error, profile, chainId) {
    if (!(error instanceof ApnError))
        return error;
    const d = error.details ?? {}, again = "No operation was written, so the same prepare may run again";
    const where = `on ${directEvmNetwork(chainId).name} (chain ${chainId})`;
    let nextActions;
    if (d.reason === "mm_gasless_fee_unquoted") {
        const required = d.mm_read_native_required_wei, current = d.mm_read_native_current_wei, symbol = d.native_symbol;
        nextActions = typeof required === "string" && typeof current === "string" && typeof symbol === "string"
            ? [`MetaMask's relay simulation for this transfer ${where} needs ${required} wei of native ${symbol} for gas on the server wallet, which ` +
                    `holds ${current} wei. APN neither sends this transfer with native gas instead nor reads it as a USDC shortfall. ${again} once MetaMask quotes a USDC relay fee.`]
            : [`MetaMask's fee quote named no cause APN can verify, so APN cannot tell whether USDC, native gas or the relay itself is short. ${again}.`];
    }
    else if (d.reason === "mm_gasless_balance" && typeof d.mm_read_usdc_current_atomic === "string" &&
        typeof d.mm_read_usdc_required_atomic === "string") {
        const required = d.mm_read_usdc_required_atomic, short = (BigInt(required) - BigInt(d.mm_read_usdc_current_atomic)).toString();
        nextActions = [`apn gasless balance --profile ${canonicalProfile(profile)} --chain ${chainId}`,
            `The server wallet's USDC ${where} is ${short} atoms (${formatAtomic(short, 6)} USDC) short of this transfer plus MetaMask's quoted relay fee. ` +
                `${again} once it holds at least ${required} USDC atoms.`];
    }
    else
        return error;
    return new ApnError(error.code, error.message, { ...error.details, nextActions });
}
export class MetaMaskGaslessService {
    context;
    records;
    operations;
    constructor(context) {
        this.context = context;
        this.records = context.metaMaskGasless?.records ?? new MetaMaskGaslessOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined, this.records);
    }
    async balance(profile, chainId) {
        const { row } = mmRegistry(mmChain(chainId)), clock = new MetaMaskGaslessClock(this.context.clock);
        clock.check();
        const owner = await metaMaskGaslessOwner(this.context.state, profile);
        clock.check();
        const rpc = this.dependencies().rpcFor(chainId);
        if (rpc.chainId !== chainId)
            mmFail("mm_gasless_rpc_binding");
        const balance = await rpc.balance(owner.address);
        clock.check(undefined, [balance.observedAt]);
        if (balance.chainId !== chainId || balance.endpointHash !== rpc.endpointHash || balance.endpointOrigin !== rpc.endpointOrigin) {
            mmFail("mm_gasless_rpc_binding");
        }
        return { profile: owner.profile, provider: "metamask-agent-wallet", chain_id: chainId,
            token: row.token, symbol: "USDC", decimals: 6, address: owner.address, balance_atomic: balance.state.usdcBalanceAtomic,
            designation: balance.state.designation, block: balance.block, observed_at: balance.observedAt,
            rpc_origin: balance.endpointOrigin, endpoint_hash: balance.endpointHash,
            sender_native_balance_required: false, proof_class: "chain_verified_public_read" };
    }
    async prepare(input) {
        const d = this.dependencies();
        const preparation = new MetaMaskGaslessPreparation({ state: this.context.state, records: this.records,
            operations: this.operations, rpcFor: d.rpcFor, provider: d.provider, clock: this.context.clock, ids: this.context.ids });
        try {
            return publicMetaMaskGaslessOperation(await preparation.prepare(input));
        }
        catch (error) {
            throw feeQuoteGuidance(await this.sessionGuidance(error, input.profile), input.profile, input.request.chainId);
        }
    }
    /**
     * A lost provider session is normally renewed with the foreground wallet connect handoff, but wallet lifecycle
     * changes wait for every unresolved operation of the profile. Point at the operation that holds the profile instead
     * of at a command that would only be refused.
     */
    async sessionGuidance(error, profileInput) {
        if (!(error instanceof ApnError) || error.code !== "APN_PROVIDER_SESSION_REQUIRED")
            return error;
        let blocking;
        try {
            await this.operations.assertProfileAvailable(this.context.state.profileHash(canonicalProfile(profileInput)));
            return error;
        }
        catch (guard) {
            if (!(guard instanceof ApnError) || guard.code !== "APN_OPERATION_BLOCKED" ||
                typeof guard.details?.blockingOperationId !== "string")
                return error;
            blocking = guard.details.blockingOperationId;
        }
        return new ApnError(error.code, error.message, { ...error.details, blockingOperationId: blocking, nextActions: [
                `apn operation status --operation ${blocking}`,
                `Wallet connect for this profile waits until operation ${blocking} is terminal. Follow its next actions; if its outcome is still unknown after its approval window, release it with apn operation abandon --operation ${blocking}. Then run the foreground wallet connect handoff again.`,
            ] });
    }
    async approve(operationId) {
        return await this.locked(operationId, async (op) => {
            if (op.terminal || op.state !== "awaiting_approval")
                return liveMetaMaskGaslessOperation(op);
            const approval = this.dependencies().approval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this MetaMask USDC transfer in a foreground terminal.", {
                    reason: "mm_gasless_approval", nextActions: [`apn gasless transfer approve --operation ${op.operationId}`],
                });
            return this.project(await this.execution().approve(op, approval));
        });
    }
    async resume(operationId, observationRpcEnv) {
        const environmentName = observationRpcEnv === undefined ? undefined : mmObservationRpcEnv(observationRpcEnv);
        return await this.locked(operationId, async (op) => {
            // An abandoned dispatch is still observed: a later chain proof replaces the owner's acknowledgement.
            const provable = op.state === "abandoned_unknown" && op.submissionAttempts === 1;
            if ((op.terminal && !provable) || op.state === "awaiting_approval")
                return liveMetaMaskGaslessOperation(op);
            if (environmentName === undefined)
                return this.project(provable ? await this.observation().run(op) : await this.execution().run(op));
            const factory = this.dependencies().observationRpcFor;
            if (factory === undefined)
                return mmFail("mm_gasless_rpc_binding");
            return this.project(await this.observation({ rpc: factory(op.intent.request.chainId, environmentName), environmentName }).run(op));
        });
    }
    /** The owner's on-chain disable of a disclosed delegation whose outcome is still unproved (no journal write). */
    async revoke(operationId) {
        return await this.locked(operationId, async (op) => await revokeMetaMaskGasless(this.context.state, op, this.dependencies().rpcFor, this.dependencies().revocation ?? {}));
    }
    async status(operationId) {
        return await this.locked(operationId, async (op) => liveMetaMaskGaslessOperation(op));
    }
    async receipt(operationId) {
        return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
    }
    project(step) {
        const result = liveMetaMaskGaslessOperation(step.operation);
        const unsaved = step.unsaved === undefined ? {} : { transient_observation: { phase: step.unsaved.observation.phase,
                reason: step.unsaved.observation.reason, observed_at: step.unsaved.observation.observedAt, scan_cursor: step.unsaved.cursor } };
        return { ...result, ...(step.warning === undefined ? {} : { transient_warning: step.warning }), ...unsaved };
    }
    dependencies() {
        if (this.context.metaMaskGasless === undefined)
            mmFail("mm_gasless_capability_unavailable");
        return this.context.metaMaskGasless;
    }
    execution() {
        const d = this.dependencies();
        return new MetaMaskGaslessExecution(this.context.state, d.rpcFor, d.provider, this.context.clock, this.save, this.context.wait);
    }
    /** Observation only; an owner-named RPC replaces the frozen endpoint for the read, never for approval or dispatch. */
    observation(observer) {
        const d = this.dependencies();
        return new MetaMaskGaslessObservationService(this.context.state, d.rpcFor, d.provider, new MetaMaskGaslessClock(this.context.clock), this.save, observer);
    }
    save = async (op, patch, at) => {
        const next = advanceMetaMaskGaslessOperation(op, patch, at);
        await this.records.persist(next);
        return next;
    };
    async locked(input, work) {
        const id = canonicalOperationId(input), first = await this.operations.required(id);
        if (first.kind !== "metamask_gasless_transfer")
            mmFail("mm_gasless_input");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${id}`], async () => {
            const current = await this.operations.required(id);
            if (current.kind !== "metamask_gasless_transfer")
                mmFail("mm_gasless_state_corrupt");
            return await work(current.record);
        });
    }
}
//# sourceMappingURL=service.js.map