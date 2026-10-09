import { getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmNativeCustody, validateEvmNativeCustody } from "./evm-native-custody.js";
import { HttpsBaseRpc } from "./rpc.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { CircleRpc } from "./circle-v2-evm/rpc.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./circle-v2-evm/catalog.js";
import { circleHex, circleRecord, circleUint, assertCircleAttestation, decodeCircleSource, verifyCircleApproval } from "./circle-v2-evm/protocol.js";
import { verifyCircleClosureFinality } from "./circle-v2-evm/preflight.js";
const verified = new WeakMap();
export function verifiedCircleNativeSources(token, profileHash, account) {
    const binding = verified.get(token);
    if (binding === undefined || binding.profileHash !== profileHash || binding.account !== account)
        blocked();
    return new Map(binding.binding.sources.map(source => [source.operationId, source.sourceIdentityHash]));
}
export function validateCircleNativeAdmission(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "recipientCustody", "sources"]) ||
        value.schemaVersion !== "apn.circle-finalized-native-admission.v1" || !Array.isArray(value.sources) || value.sources.length !== 1)
        blocked();
    validateEvmNativeCustody(value.recipientCustody);
    for (const source of value.sources)
        if (!isPlainRecord(source) || !exactKeys(source, ["operationId", "sourceIdentityHash"]) ||
            ![source.operationId, source.sourceIdentityHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
            blocked();
    return value;
}
function eligible(op, profileHash, account) {
    return op.profileHash === profileHash && op.sourceCustody.profileHash === profileHash && op.sourceCustody.walletAddress === account &&
        ["awaiting_mint", "mint_unknown", "awaiting_finality", "completed"].includes(op.state) && op.source?.finalityTag === "finalized" &&
        op.attestation !== null && op.residualAllowanceAtomic === "0" && op.effects.some(e => e.role === "approval") &&
        op.effects.some(e => e.role === "burn") && op.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed" && e.proof !== null);
}
export function circleNativeSourceIdentity(op) {
    return hashObject({ sourceCustody: op.sourceCustody, source: op.source, attestation: op.attestation,
        effects: op.effects.filter(e => e.role !== "mint"), residualAllowanceAtomic: op.residualAllowanceAtomic });
}
function envelope(effect, input) {
    const t = circleRecord(input), e = effect.envelope;
    if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic ||
        circleUint(t.gas).toString() !== e.gasLimitAtomic || circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic ||
        circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic || circleHex(t.input) !== e.data ||
        getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== 42161n)
        blocked();
}
function sameReceipt(old, current) {
    for (const key of ["transactionHash", "blockHash", "blockNumberAtomic", "transactionHashBinding", "receiptHash", "logsHash", "actualFeeAtomic"])
        if (old[key] !== current[key])
            blocked();
}
export async function verifyCircleNativeAdmission(state, port, profile, account, recipient, expected) {
    const profileHash = state.profileHash(profile);
    const candidates = (await new CircleRepository(state.root).listOperations(profileHash)).filter(op => !op.terminal && eligible(op, profileHash, account));
    if (expected === undefined && candidates.length === 0)
        return null;
    const recipientCustody = await evmNativeCustody(state, "default");
    if (recipientCustody.walletAddress !== recipient) {
        if (expected !== undefined)
            blocked();
        return null;
    }
    if (expected !== undefined && hashObject(recipientCustody) !== hashObject(validateCircleNativeAdmission(expected).recipientCustody))
        blocked();
    const owner = await evmNativeCustody(state, profile);
    const op = expected === undefined ? candidates.length === 1 ? candidates[0] : undefined :
        await new CircleRepository(state.root).load(expected.sources[0].operationId);
    if (op == null) {
        if (expected !== undefined)
            blocked();
        return null;
    }
    if (!eligible(op, profileHash, account) || hashObject(owner) !== hashObject(op.sourceCustody) ||
        expected !== undefined && expected.sources[0].sourceIdentityHash !== circleNativeSourceIdentity(op))
        blocked();
    port.armEvmDirectRpcGuard?.();
    assertCircleAttestation(op.source, op.attestation);
    /** Exactly fourteen scalar read POSTs for one saved source. No journal mutation or custody entry. */
    class PublicCircleReads extends CircleRpc {
        port;
        count = 0;
        constructor(port) {
            super("https://public.invalid", 42161);
            this.port = port;
        }
        async call(method, params) {
            if (++this.count > 14 || !["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_call"].includes(method) ||
                this.port.coinbaseGaslessCall === undefined)
                blocked();
            return await this.port.coinbaseGaslessCall(method, params);
        }
    }
    const rpc = new PublicCircleReads(port), approval = op.effects.find(e => e.role === "approval"), burn = op.effects.find(e => e.role === "burn");
    const a = await rpc.observation(approval.transactionHash, "finalized"), b = await rpc.observation(burn.transactionHash, "finalized");
    if (a === null || b === null)
        blocked();
    envelope(approval, a.transaction);
    envelope(burn, b.transaction);
    const historical = String(await rpc.read(CIRCLE_SOURCE_TOKEN, "allowance", [owner.walletAddress, CIRCLE_MESSENGER], { blockHash: circleRecord(a.canonicalBlock).hash, requireCanonical: true }));
    const zero = String(await rpc.read(CIRCLE_SOURCE_TOKEN, "allowance", [owner.walletAddress, CIRCLE_MESSENGER], { blockHash: circleRecord(b.finalityHead).hash, requireCanonical: true }));
    if (zero !== "0")
        blocked();
    sameReceipt(approval.proof, verifyCircleApproval(a, false, historical));
    const source = decodeCircleSource(b, op.destinationChain);
    sameReceipt(burn.proof, source);
    verifyCircleClosureFinality(op.source, source);
    const binding = { schemaVersion: "apn.circle-finalized-native-admission.v1", recipientCustody,
        sources: [{ operationId: op.operationId, sourceIdentityHash: circleNativeSourceIdentity(op) }] };
    // The public journal projection must never alias the private verified authority snapshot.
    const snapshot = Object.freeze({ schemaVersion: binding.schemaVersion,
        recipientCustody: Object.freeze({ ...binding.recipientCustody }),
        sources: Object.freeze(binding.sources.map(source => Object.freeze({ ...source }))) });
    const token = Object.freeze({ kind: "verified-circle-native-source" });
    verified.set(token, Object.freeze({ binding: snapshot, profileHash, account }));
    return { binding, token };
}
/** Native calls this after foreground approval, before the actual signature; one additional pending nonce read. */
export async function recheckCircleNativeAdmission(state, operation, port) {
    const binding = operation.evm?.circleNativeAdmission;
    if (binding === undefined)
        return null;
    if (operation.chainId !== 42161 || operation.evm?.asset.kind !== "native")
        blocked();
    const rpc = port ?? new HttpsBaseRpc(operation.evm.feeQuote.rpcOrigin, { directGuardState: state });
    rpc.armEvmDirectRpcGuard?.();
    const result = await verifyCircleNativeAdmission(state, rpc, operation.profile, operation.walletAddress, operation.recipient, binding);
    if (result === null || rpc.coinbaseGaslessCall === undefined || circleUint(await rpc.coinbaseGaslessCall("eth_getTransactionCount", [operation.walletAddress, "pending"])).toString() !== operation.economics?.nonceAtomic)
        blocked();
    return result.token;
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Finalized Circle source admission is unavailable or changed; retain the existing source holds."); }
//# sourceMappingURL=circle-native-admission.js.map