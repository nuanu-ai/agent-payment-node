import { assertMetaMaskNativeConflictDomainAvailable } from "./metamask-native-journal.js";
import { assertCircleAttestation } from "./circle-v2-evm/protocol.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { MerchantRepository } from "./x402-merchant/repository.js";
import { validateMerchant } from "./x402-merchant/model.js";
import { Permit2ProductionRepository, validatePermit2ProductionRecord } from "./x402-permit2/production-repository.js";
import { ApnError } from "./errors.js";
import { assertUsdtConflictDomainsAvailable, conflictDomainKeys, evmConflictDomain, railConflictDomain, sharedConflictDomainKeys, sharedEvmConflictDomain } from "./operation-conflict-domain.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "./relay-unsigned-operation.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "./evm-address-ownership.js";
import { OperationIndex } from "./operation-index/index.js";
import { relayStatus } from "./operation-index/adapters/relay.js";
import { x402StoredOutcome, x402StoredReceiptOutcome } from "./operation-index/adapters/x402.js";
import { profileClaim, providerClaims, UNREADABLE_PROVIDER_CLAIM } from "./operation-index/types.js";
const FACADE_KINDS = new Set(["sei_gaszip", "circle_route", "mega_gaszip", "merchant_x402",
    "permit2_production", "relay_unsigned", "facilitator_gasless_transfer", "smart_account_gasless_transfer", "metamask_gasless_transfer",
    "gasless_transfer", "bridge_route", "rail_transfer", "direct_transfer", "x402_fetch"]);
/**
 * The money-operation facade over the operation index (src/operation-index): idempotency, lookup and the
 * one-operation-per-account guard read one index entry and at most the blocking records, never every store.
 * Repository ports that older call sites still pass are not read: each family is read through its index adapter.
 */
export class OperationService {
    state;
    providerX402;
    index;
    constructor(state, providerX402 = new ProviderX402Repository(state.root), ..._unreadPorts) {
        this.state = state;
        this.providerX402 = providerX402;
        this.index = new OperationIndex(state);
    }
    /** Create-only Relay insertion. Profile, operation, idempotency, then owner-address
     * locks are acquired together so owner validation and durable write are atomic. */
    async persistRelayUnsigned(operation) {
        validateRelayUnsignedOperation(operation);
        await this.state.initialize();
        return await this.state.withLocks([
            `profile:${operation.profileHash}`, `operation:${operation.operationId}`,
            `operation:idempotency:${operation.idempotencyHash}`, evmAddressLock(operation.sourceAccount),
        ], async () => {
            const existing = await this.resolvePrepare({ kind: "relay_unsigned", profileHash: operation.profileHash,
                operationId: operation.operationId, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash });
            if (existing !== null) {
                if (existing.kind !== "relay_unsigned" || existing.record.integrityHash !== operation.integrityHash) {
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay unsigned operation cannot be changed or replayed with different inputs.");
                }
                return existing.record;
            }
            try {
                await this.required(operation.operationId);
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Operation ID is already bound to another money operation.");
            }
            catch (error) {
                if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_NOT_FOUND")
                    throw error;
            }
            await this.assertProfileAvailable(operation.profileHash);
            await assertExclusiveEvmOwner(this.state, operation.sourceAccount, operation.profileHash);
            await new RelayUnsignedOperationRepository(this.state.root).persistLocked(operation);
            return operation;
        });
    }
    async resolvePrepare(input) {
        const existing = await this.findIdempotency(input.idempotencyHash);
        if (existing === null)
            return null;
        if (existing.kind !== input.kind || existing.record.profileHash !== input.profileHash ||
            existing.record.operationId !== input.operationId || existing.record.requestHash !== input.requestHash)
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different operation inputs.");
        return existing;
    }
    /** Pure lookup lets callers defer to the full prepare resolver before any lifecycle upgrade. */
    async findIdempotency(idempotencyHash) {
        const entry = await this.index.findByIdempotency(idempotencyHash);
        if (entry === null)
            return null;
        // An operation of a family this facade does not model still owns the key.
        if (!FACADE_KINDS.has(entry.family))
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to another operation family.");
        return await this.stored(entry);
    }
    async assertProfileAvailable(profileHash) {
        await this.index.assertAvailable({ family: null, profileHash, claims: [profileClaim(profileHash)] });
    }
    /** A new EVM money operation waits only for unresolved operations on the same chain and sending account. */
    async assertEvmAccountAvailable(profileHash, chainId, account) {
        await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(chainId, account)]);
    }
    /** R8 (OWNR-16): a native Arbitrum move to a local custody wallet does not wait for this account's Circle routes whose source burn is final. */
    async assertEvmNativeAccountAvailableBesideSettledCircle(profileHash, account) {
        await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(42161, account)], undefined, { kind: "native_beside_settled_circle", account });
    }
    /** A local EIP-3009 x402 purchase waits only for exclusive claims on its chain and account, never for another purchase. */
    async assertEvmAccountSharedAvailable(profileHash, chainId, account) {
        await this.assertConflictDomainsAvailable(profileHash, () => [sharedEvmConflictDomain(chainId, account)]);
    }
    /** The account check of one saved operation, excluding only that operation's own claim; its owner holds the account locks. */
    async assertEvmAccountAvailableExcept(profileHash, chainId, account, exceptOperationId) {
        await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(chainId, account)], canonicalOperationId(exceptOperationId));
    }
    /** Only a checked saved Permit2 operation can exclude its own existing conflict claim. */
    async assertPermit2AccountAvailable(record) {
        validatePermit2ProductionRecord(record);
        const saved = await new Permit2ProductionRepository(this.state.root).findOperation(record.operationId);
        if (saved === null || saved.integrityHash !== record.integrityHash)
            throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 conflict exclusion requires the exact saved operation.");
        await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(43114, record.material.wallet.account)], record.operationId);
    }
    /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
    async assertRailAccountAvailable(profileHash, rail, account) {
        await this.assertConflictDomainsAvailable(profileHash, () => [railConflictDomain(rail, account)]);
    }
    async assertConflictDomainsAvailable(profileHash, domains, exceptOperationId, tag) {
        const wanted = conflictDomainKeys(domains), coexisting = sharedConflictDomainKeys(domains);
        if (this.state.root !== undefined)
            await assertUsdtConflictDomainsAvailable(this.state.root, wanted, exceptOperationId);
        if (this.state.root !== undefined) {
            for (const wantedKey of wanted) {
                const [family, network, account] = wantedKey.split(":");
                if (family !== "evm" || network === undefined || account === undefined)
                    continue;
                await assertMetaMaskNativeConflictDomainAvailable(this.state.root, network, account, exceptOperationId);
            }
        }
        // An unreadable network or account on the caller's side waits for every unresolved operation of the profile.
        const claims = wanted.size === 0 ? [profileClaim(profileHash)]
            : [...wanted].map(key => coexisting.has(key) ? { key, shared: true } : { key });
        await this.index.assertAvailable({ family: null, profileHash, claims,
            ...(exceptOperationId === undefined ? {} : { except: exceptOperationId }), ...(tag === undefined ? {} : { tag }) });
    }
    /** Both Circle signing accounts are held under their existing profile locks. */
    async assertCircleAccountsAvailable(record, exceptSaved = false, effectRole) {
        if (exceptSaved) {
            const saved = await new CircleRepository(this.state.root).loadAny(record.operationId);
            if (saved === null || saved.integrityHash !== record.integrityHash)
                throw new ApnError("APN_OPERATION_BLOCKED", "Circle exclusion requires the exact durable journal.");
        }
        const except = exceptSaved ? record.operationId : undefined;
        const settledSourceMint = exceptSaved && effectRole === "mint" && record.source?.finalityTag === "finalized" &&
            record.attestation !== null && record.residualAllowanceAtomic === "0" && record.effects.find(e => e.role === "burn")?.phase === "confirmed" &&
            record.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed");
        // Finalized source settlement is read-only during mint. Its signer remains occupied for all other financial roles.
        if (settledSourceMint)
            assertCircleAttestation(record.source, record.attestation, record.schemaVersion === "apn.circle-v2-evm-operation.v2" ? record.funding : undefined);
        else
            await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(42161, record.sourceCustody.walletAddress)], except, { kind: "circle_source_after_burn" });
        await this.assertConflictDomainsAvailable(record.destinationProfileHash, () => [evmConflictDomain(record.destinationChain, record.destinationCustody.walletAddress)], except);
    }
    /** The provider account and payer are held across profiles by provider direct and provider x402 operations. */
    async assertProviderAccountAvailable(providerId, accountBindingHash, payer, exceptOperationId) {
        await this.index.assertAvailable({ family: null, profileHash: null,
            claims: [...providerClaims(providerId, accountBindingHash, payer), UNREADABLE_PROVIDER_CLAIM],
            ...(exceptOperationId === undefined ? {} : { except: exceptOperationId }) });
    }
    async assertMerchantAccountAvailable(record) {
        validateMerchant(record);
        const saved = await new MerchantRepository(this.state.root).findOperation(record.operationId);
        if (saved === null || saved.integrityHash !== record.integrityHash)
            throw new ApnError("APN_OPERATION_BLOCKED", "Merchant conflict exclusion requires the exact saved operation.");
        await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(4326, record.custody.walletAddress)], record.operationId);
    }
    async required(operationId) {
        const entry = await this.index.find(canonicalOperationId(operationId));
        if (entry === null || !FACADE_KINDS.has(entry.family))
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        const found = await this.stored(entry);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return found;
    }
    async status(operationId) {
        const found = await this.required(operationId);
        const adapter = this.index.adapter({ family: found.kind });
        return await adapter.view(found.kind === "x402_fetch" ? found : found.record, this.state.root);
    }
    async relayStatus(operation) {
        return await relayStatus(this.state.root, operation);
    }
    async x402Outcome(operationId, options) {
        return await x402StoredOutcome(this.state, this.providerX402, await this.requiredX402(operationId), options);
    }
    async x402ReceiptOutcome(operationId) {
        return await x402StoredReceiptOutcome(this.state, this.providerX402, await this.requiredX402(operationId));
    }
    async requiredX402(operationId) {
        const found = await this.required(operationId);
        if (found.kind !== "x402_fetch")
            throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
        return found;
    }
    /** The record behind an entry through its family's own reader (its errors propagate); null when absent. */
    async stored(entry) {
        if (entry.unreadableReason === "duplicate_operation_id")
            throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
        const record = await this.index.loadRecord(entry);
        if (record === null)
            return null;
        return (entry.family === "x402_fetch" ? { kind: "x402_fetch", ...record }
            : { kind: entry.family, record });
    }
}
//# sourceMappingURL=operation-service.js.map