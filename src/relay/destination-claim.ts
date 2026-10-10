/** Permanent create-only ownership of one canonical destination payout. */
import { canonicalJson, domainHash, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { RelayNativeSourceJournalRepository } from "./native-source.js";
import type { RelayBnbRecipientCreditEvidence } from "./destination-proof.js";
const hash = /^0x[0-9a-fA-F]{64}$/u;
export class RelayDestinationClaimRepository extends SecureStateStore {
  async claim(op: RelayUnsignedOperation, sourceHash: string, proof: RelayBnbRecipientCreditEvidence): Promise<void> {
    if (op.sourceChainId !== 8453 || ![137, 4326].includes(op.destinationChainId) || !op.nativeQuote || !op.statusLocator ||
      !hash.test(sourceHash) || !hash.test(proof.destinationTransactionHash) || proof.sourceDepositHash?.toLowerCase() !== sourceHash.toLowerCase() ||
      proof.operationId !== op.operationId || proof.operationIntegrityHash !== op.integrityHash || proof.quoteDigest !== op.quoteDigest ||
      proof.orderId !== op.nativeQuote.orderId || proof.recipient !== op.recipient.toLowerCase() ||
      proof.minimumOutputWei !== op.minOutputAtomic || BigInt(proof.creditedWei) < BigInt(op.minOutputAtomic))
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay destination claim binding is invalid.");
    const source = await new RelayNativeSourceJournalRepository(this.root).load(op);
    if (source?.phase !== "confirmed" || source.transactionHash?.toLowerCase() !== sourceHash.toLowerCase())
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay payout claim requires the confirmed source operation.");
    const key = domainHash("apn.relay-destination-payout-key.v1", canonicalJson({ chainId: op.destinationChainId, transactionHash: proof.destinationTransactionHash.toLowerCase() }));
    const binding = { schemaVersion: "apn.relay-destination-payout-claim.v1", chainId: op.destinationChainId,
      transactionHash: proof.destinationTransactionHash.toLowerCase(), requestId: op.statusLocator.requestId,
      operationId: op.operationId, operationIntegrityHash: op.integrityHash, sourceTransactionHash: sourceHash.toLowerCase(),
      orderId: op.nativeQuote.orderId, recipient: proof.recipient,
      token: op.destinationChainId === 4326 ? "0xfafddbb3fc7688494971a79cc65dca3ef82079e7" : "native",
      amountAtomic: proof.creditedWei, blockNumber: proof.destinationBlockNumber, blockHash: proof.destinationBlockHash };
    const expected = { ...binding, integrityHash: hashObject(binding) };
    await this.initialize();
    await this.withLocks([`relay-destination-payout:${key}`], async () => {
      await this.ensureDirectory("relay-destination-payout-claims");
      const path = `relay-destination-payout-claims/${key}.json`, saved = await this.readJson(path);
      if (saved !== null) {
        if (canonicalJson(saved) !== canonicalJson(expected)) throw new ApnError("APN_OPERATION_BLOCKED", "Relay destination payout is already claimed.");
        return;
      }
      // SecureStateStore fsyncs file and directory; never updates or removes claims.
      await this.writeJson(path, expected, true);
    });
  }
}
