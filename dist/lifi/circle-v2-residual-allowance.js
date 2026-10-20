/**
 * The Base USDC allowance a finished Circle Base to Solana burn left on the WithFees wrapper. A burn spends principal plus
 * fee of what the payer approved; the rest stays until `apn circle approval revoke` clears it. The value is read once, at
 * the finalized head, and stored beside the operation's journal with its block; later statuses show the stored value and
 * read the chain again only on an explicit refresh. A proven revoke updates it to 0 at the revoke's own block.
 */
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { assertFinalizedChain } from "../evm-finalized-proof.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
export const CIRCLE_RESIDUAL_SCHEMA = "apn.circle-v2-residual-allowance.v1";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SUFFIX = ".residual-allowance.json", WORD = /^0x[0-9a-f]{64}$/u, UINT = /^(?:0|[1-9][0-9]*)$/u;
const KEYS = ["allowanceAtomic", "block", "chainId", "integrityHash", "observedAt", "operationId", "owner", "profileHash", "proof",
    "revokeOperationId", "schemaVersion", "spender", "token"];
function corrupt() {
    throw new ApnError("APN_STATE_CORRUPT", "A stored Circle residual allowance is not the one its operation allows.", { reason: "circle_residual_binding" });
}
function validate(value, profileHash, operationId) {
    if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(KEYS))
        corrupt();
    const record = value, { integrityHash, ...fields } = record;
    if (record.schemaVersion !== CIRCLE_RESIDUAL_SCHEMA || hashObject(fields) !== integrityHash || record.operationId !== operationId ||
        record.profileHash !== profileHash || record.chainId !== 8453 || record.token !== BASE_USDC || !UINT.test(record.allowanceAtomic) ||
        !isPlainRecord(record.block) || !UINT.test(record.block.numberAtomic) || !WORD.test(record.block.hash) ||
        !["finalized_allowance_read", "revoke_approval"].includes(record.proof) || typeof record.observedAt !== "string")
        corrupt();
    return record;
}
function seal(fields) {
    return { ...fields, integrityHash: hashObject(fields) };
}
/** `non-evm-source-journals/<profileHash>/<operationId>.residual-allowance.json`: never a record name, so the index skips it. */
export class CircleResidualAllowanceStore extends SecureStateStore {
    path(profileHash, operationId) {
        stateIdentifier(profileHash, "Circle residual profile");
        stateIdentifier(operationId, "Circle residual operation");
        return `non-evm-source-journals/${profileHash}/${operationId}${SUFFIX}`;
    }
    async load(journal) {
        const value = await this.readJson(this.path(journal.profileHash, journal.operationId));
        if (value === null)
            return null;
        const record = validate(value, journal.profileHash, journal.operationId);
        if (record.owner !== journal.sourceCall.from || record.spender !== journal.sourceCall.to)
            corrupt();
        return record;
    }
    /** Stores a value unless the stored one is at a later block; returns what is stored. */
    async keepNewer(record) {
        return await this.withLocks([`circle-residual:${record.profileHash}`], async () => {
            const path = this.path(record.profileHash, record.operationId), raw = await this.readJson(path);
            const stored = raw === null ? null : validate(raw, record.profileHash, record.operationId);
            if (stored !== null && BigInt(stored.block.numberAtomic) > BigInt(record.block.numberAtomic))
                return stored;
            await this.writeJson(path, record);
            return record;
        });
    }
    /**
     * A revoke proven at `block` (Approval with value 0 and a fresh zero allowance) sets every stored residual of the same
     * owner and wrapper in the profile to 0, unless one was stored at a later block. Only existing values are updated.
     */
    async revoked(profileHash, owner, spender, block, revokeOperationId, observedAt) {
        stateIdentifier(profileHash, "Circle residual profile");
        await this.withLocks([`circle-residual:${profileHash}`], async () => {
            for (const entry of await this.readDirectory(`non-evm-source-journals/${profileHash}`)) {
                if (!entry.isFile() || !entry.name.endsWith(SUFFIX))
                    continue;
                const operationId = entry.name.slice(0, -SUFFIX.length), path = this.path(profileHash, operationId);
                const raw = await this.readJson(path);
                if (raw === null)
                    continue;
                const stored = validate(raw, profileHash, operationId);
                if (stored.owner.toLowerCase() !== owner.toLowerCase() || stored.spender.toLowerCase() !== spender.toLowerCase() || stored.allowanceAtomic === "0" ||
                    BigInt(stored.block.numberAtomic) > BigInt(block.numberAtomic))
                    continue;
                const { integrityHash: _old, ...fields } = stored;
                await this.writeJson(path, seal({ ...fields, allowanceAtomic: "0", block, proof: "revoke_approval", revokeOperationId, observedAt }));
            }
        });
    }
}
/**
 * The residual shown by a status of a resolved burn: the stored value, or (when nothing is stored yet, or on an explicit
 * refresh) one eth_call at the finalized head, stored. `proven` is an endpoint this status already proved to serve Base,
 * and `head` its finalized block when it read one. An unreadable value is reported with its reason, never guessed.
 */
export async function circleResidualAllowance(root, journal, read, refresh, now, proven, head) {
    const store = new CircleResidualAllowanceStore(root), stored = await store.load(journal);
    const base = { token: BASE_USDC, owner: journal.sourceCall.from, spender: journal.sourceCall.to };
    const view = (record, readByThisStatus, unreadReason) => ({ ...base,
        allowanceAtomic: record.allowanceAtomic, block: record.block, proof: record.proof, revokeOperationId: record.revokeOperationId,
        observedAt: record.observedAt, readByThisStatus, ...(unreadReason === undefined ? {} : { unreadReason }) });
    const unread = (reason) => stored !== null ? view(stored, false, reason)
        : { ...base, allowanceAtomic: null, block: null, proof: null, revokeOperationId: null, observedAt: null, readByThisStatus: false, unreadReason: reason };
    if (stored !== null && !refresh)
        return view(stored, false);
    if (read === undefined)
        return unread("This runtime has no finalized-tag reader for Base.");
    try {
        const rpc = proven ?? read(8453);
        if (proven === undefined)
            await assertFinalizedChain(rpc, 8453);
        const block = head ?? finalizedBlock(await rpc.call("eth_getBlockByNumber", ["finalized", false]));
        const word = (address) => address.slice(2).toLowerCase().padStart(64, "0");
        const value = await rpc.call("eth_call", [{ to: BASE_USDC, data: `0xdd62ed3e${word(base.owner)}${word(base.spender)}` },
            `0x${BigInt(block.numberAtomic).toString(16)}`]);
        if (typeof value !== "string" || !WORD.test(value.toLowerCase()))
            throw new ApnError("APN_RPC_PROTOCOL", "The allowance read is malformed.");
        const fresh = seal({ schemaVersion: CIRCLE_RESIDUAL_SCHEMA, operationId: journal.operationId, profileHash: journal.profileHash,
            chainId: 8453, ...base, allowanceAtomic: BigInt(value).toString(), block, proof: "finalized_allowance_read", revokeOperationId: null,
            observedAt: new Date(now()).toISOString() });
        const kept = await store.keepNewer(fresh);
        return view(kept, kept === fresh);
    }
    catch (error) {
        if (!(error instanceof ApnError))
            throw error;
        return unread(`${error.code}: ${error.message}`);
    }
}
/** The finalized block a status already read: its number and hash. */
export function finalizedBlock(value) {
    if (!isPlainRecord(value) || typeof value.hash !== "string" || !WORD.test(value.hash.toLowerCase())) {
        throw new ApnError("APN_RPC_PROTOCOL", "The finalized block is malformed.");
    }
    return { numberAtomic: evmRpcQuantity(value.number).toString(), hash: value.hash.toLowerCase() };
}
//# sourceMappingURL=circle-v2-residual-allowance.js.map