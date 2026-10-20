/** Permanent create-only ownership of one canonical destination payout: one payout accepts one operation, on every lane. */
import { canonicalJson, domainHash, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { RelayNativeSourceJournalRepository } from "./native-source.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RELAY_MEGA_USDM } from "./native-routes.js";
import { ETHEREUM_USDC } from "./quote.js";
const hash = /^0x[0-9a-fA-F]{64}$/u;
function invalid() { throw new ApnError("APN_OPERATION_BLOCKED", "Relay destination claim binding is invalid."); }
function unconfirmed() { throw new ApnError("APN_OPERATION_BLOCKED", "Relay payout claim requires the confirmed source operation."); }
export class RelayDestinationClaimRepository extends SecureStateStore {
    async claim(op, sourceHash, proof) {
        if (![56, 8453].includes(op.sourceChainId) || ![137, 143, 4326].includes(op.destinationChainId) || !op.nativeQuote || !op.statusLocator ||
            !hash.test(sourceHash) || !hash.test(proof.destinationTransactionHash) || proof.sourceDepositHash?.toLowerCase() !== sourceHash.toLowerCase() ||
            proof.operationId !== op.operationId || proof.operationIntegrityHash !== op.integrityHash || proof.quoteDigest !== op.quoteDigest ||
            proof.orderId !== op.nativeQuote.orderId || proof.recipient !== op.recipient.toLowerCase() ||
            proof.minimumOutputWei !== op.minOutputAtomic || BigInt(proof.creditedWei) < BigInt(op.minOutputAtomic))
            invalid();
        const source = await new RelayNativeSourceJournalRepository(this.root).load(op);
        if (source?.phase !== "confirmed" || source.transactionHash?.toLowerCase() !== sourceHash.toLowerCase())
            unconfirmed();
        await this.persist(op, sourceHash, op.nativeQuote.orderId, { transactionHash: proof.destinationTransactionHash,
            recipient: proof.recipient, token: op.destinationChainId === 4326 ? RELAY_MEGA_USDM : "native",
            amountAtomic: proof.creditedWei, blockNumber: proof.destinationBlockNumber, blockHash: proof.destinationBlockHash });
    }
    /** The Ethereum USDC payout of an Arbitrum USDC operation whose deposit the saved source journal records as final. */
    async claimEthereumUsdc(op, sourceHash, proof) {
        const draft = op.arbitrumDraft;
        if (draft === undefined || op.sourceChainId !== 42161 || op.destinationChainId !== 1 || !op.statusLocator ||
            !hash.test(sourceHash) || !hash.test(proof.destinationTransactionHash) || proof.quoteDigest !== op.quoteDigest ||
            proof.orderId !== draft.orderId || proof.recipient !== op.recipient.toLowerCase() ||
            proof.token !== ETHEREUM_USDC.toLowerCase() || proof.minimumOutputAtomic !== op.minOutputAtomic ||
            BigInt(proof.creditedAtomic) < BigInt(op.minOutputAtomic))
            invalid();
        const deposit = (await new ArbitrumSourceEffectJournalRepository(this.root).load(op.profileHash, op.operationId))?.effects[1];
        if (deposit?.phase !== "confirmed" || deposit.attempt?.transactionHash?.toLowerCase() !== sourceHash.toLowerCase())
            unconfirmed();
        await this.persist(op, sourceHash, draft.orderId, { transactionHash: proof.destinationTransactionHash, recipient: proof.recipient,
            token: proof.token, amountAtomic: proof.creditedAtomic, blockNumber: proof.destinationBlockNumber, blockHash: proof.destinationBlockHash });
    }
    /** The BNB or Base native payout of an Ethereum USDC operation whose deposit the saved effect journal records as final. */
    async claimEthereumSource(op, sourceHash, proof) {
        const quote = op.quote;
        if (quote === undefined || op.sourceChainId !== 1 || ![56, 8453].includes(op.destinationChainId) || !op.statusLocator || !hash.test(sourceHash) ||
            !hash.test(proof.destinationTransactionHash) || proof.operationId !== op.operationId || proof.operationIntegrityHash !== op.integrityHash ||
            proof.quoteDigest !== op.quoteDigest || proof.orderId !== quote.orderId || proof.recipient !== op.recipient.toLowerCase() ||
            proof.minimumOutputWei !== op.minOutputAtomic || BigInt(proof.creditedWei) < BigInt(op.minOutputAtomic))
            invalid();
        const deposit = (await new RelayEffectJournalRepository(this.root).load(op.profileHash, op.operationId))?.effects[1];
        if (deposit?.phase !== "confirmed" || deposit.attempt?.transactionHash?.toLowerCase() !== sourceHash.toLowerCase())
            unconfirmed();
        await this.persist(op, sourceHash, quote.orderId, { transactionHash: proof.destinationTransactionHash, recipient: proof.recipient,
            token: "native", amountAtomic: proof.creditedWei, blockNumber: proof.destinationBlockNumber, blockHash: proof.destinationBlockHash });
    }
    async persist(op, sourceHash, orderId, payout) {
        const key = domainHash("apn.relay-destination-payout-key.v1", canonicalJson({ chainId: op.destinationChainId, transactionHash: payout.transactionHash.toLowerCase() }));
        const binding = { schemaVersion: "apn.relay-destination-payout-claim.v1", chainId: op.destinationChainId,
            transactionHash: payout.transactionHash.toLowerCase(), requestId: op.statusLocator.requestId,
            operationId: op.operationId, operationIntegrityHash: op.integrityHash, sourceTransactionHash: sourceHash.toLowerCase(),
            orderId, recipient: payout.recipient, token: payout.token,
            amountAtomic: payout.amountAtomic, blockNumber: payout.blockNumber, blockHash: payout.blockHash };
        const expected = { ...binding, integrityHash: hashObject(binding) };
        await this.initialize();
        await this.withLocks([`relay-destination-payout:${key}`], async () => {
            await this.ensureDirectory("relay-destination-payout-claims");
            const path = `relay-destination-payout-claims/${key}.json`, saved = await this.readJson(path);
            if (saved !== null) {
                if (canonicalJson(saved) !== canonicalJson(expected))
                    throw new ApnError("APN_OPERATION_BLOCKED", "Relay destination payout is already claimed.");
                return;
            }
            // SecureStateStore fsyncs file and directory; never updates or removes claims.
            await this.writeJson(path, expected, true);
        });
    }
}
//# sourceMappingURL=destination-claim.js.map