/** Explicit local retirement of an untouched prepared Relay quote. */
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayNativeSourceJournalRepository } from "./native-source.js";
import { RelayEncryptedApprovalCustody } from "./approval-effect.js";
import { RELAY_BNB_SOURCE, RELAY_BNB_DEFAULT_SOURCE, relayNativeRoute } from "./native-quote.js";
export class RelayRetireService {
    state;
    clock;
    wrapping;
    constructor(state, clock, wrapping = new MacOSLoginKeychainSecret()) {
        this.state = state;
        this.clock = clock;
        this.wrapping = wrapping;
    }
    async retire(input) {
        if ((input.profile !== "default" && input.profile !== "evm-live-buyer") || !/^[a-f0-9]{64}$/u.test(input.operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay retirement requires an admitted profile and an operation ID.");
        allowlistProfileHash(input.profile);
        const profileHash = this.state.profileHash(input.profile);
        await this.state.initialize();
        return this.state.withLocks([`profile:${profileHash}`, `operation:${input.operationId}`,
            `relay-native-source:${input.operationId}`,
            evmAddressLock(input.profile === "evm-live-buyer" ? RELAY_BNB_SOURCE : RELAY_BNB_DEFAULT_SOURCE)], async () => {
            const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, input.operationId);
            if (op === null) {
                // Distinguish an operation belonging to another profile from one that does not exist.
                await new OperationService(this.state).required(input.operationId);
                throw new ApnError("APN_OPERATION_BLOCKED", "The operation is not a prepared Relay quote for this profile.");
            }
            if (op.arbitrumDraft !== undefined) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum retirement requires its source effect lifecycle.");
            }
            if (input.profile === "evm-live-buyer" || op.nativeQuote !== undefined) {
                let route = null;
                try {
                    route = relayNativeRoute(op.sourceAccount, op.recipient);
                }
                catch { /* outside the native lanes */ }
                if (route === null || route.profile !== input.profile || op.nativeQuote === undefined || op.quote !== undefined ||
                    op.sourceChainId !== 56 || op.destinationChainId !== route.chainId ||
                    op.sourceAccount.toLowerCase() !== route.payer.toLowerCase() ||
                    op.nativeQuote.routeReference !== route.reference ||
                    op.policyDigest === undefined || op.policyRevision === undefined) {
                    throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement requires an exact profile native quote.");
                }
            }
            const retirements = new RelayRetirementRepository(this.state.root);
            const existing = await retirements.load(op);
            // Any effect intent, including a pending journal, makes local retirement unsafe.
            if (await new RelayEffectJournalRepository(this.state.root).load(profileHash, input.operationId) !== null) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because an effect journal exists.");
            }
            const nativeJournal = op.nativeQuote !== undefined
                ? await new RelayNativeSourceJournalRepository(this.state.root).load(op) : null;
            if (nativeJournal !== null && nativeJournal.phase !== "failed_before_effect") {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because a native source journal exists.");
            }
            const nativeReservationId = nativeJournal === null ? undefined : assetUsageReservationId({
                account: getAddress(op.sourceAccount), chain: "eip155:56", asset: { kind: "native", identifier: null },
            }, `relay-native-execute:${op.operationId}`);
            if (nativeReservationId !== undefined &&
                (await new AssetUsageLedger(this.state.root).load({ account: getAddress(op.sourceAccount),
                    chain: "eip155:56", asset: { kind: "native", identifier: null } }, nativeReservationId))?.state !== "failed_before_effect") {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement requires a reconciled no-effect native usage reservation.");
            }
            return new RelayEncryptedApprovalCustody(this.state, this.wrapping).withNoMaterial(op, async () => new AssetUsageLedger(this.state.root).withNoMatchingRelayReservation(op.sourceAccount, op.policyDigest, op.amountAtomic, async () => {
                if (existing !== null)
                    return publicRelayUnsignedOperation(op, existing);
                const now = this.clock.now();
                if (!Number.isFinite(now.getTime()))
                    throw new ApnError("APN_INVALID_INPUT", "Relay retirement clock is invalid.");
                return publicRelayUnsignedOperation(op, await retirements.persistLocked(op, now.toISOString()));
            }, op.nativeQuote !== undefined ? 56 : 1, nativeReservationId), input.profile);
        });
    }
}
//# sourceMappingURL=retire.js.map