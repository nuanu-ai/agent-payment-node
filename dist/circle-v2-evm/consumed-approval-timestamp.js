import { hashObject } from "../canonical.js";
import { assertConsumedBurnIdentity } from "./burn-retirement.js";
import { circleBlocked } from "./operation-model.js";
import { circleHex, circleRecord, circleUint } from "./protocol.js";
const APPROVAL_BLOCK = "0xa2bb2cf6a0f164560e53421fcb3ac857e1fa3121075b8409b7722210438ef798";
const SAVED_TRANSACTION_BINDING = "2863adadea86047a2de352d5a8d02d6f0655204abdf29f12a070c50dc9e8533d";
/** Only this consumed85 recovery may reconstruct a missing optional RPC field from its canonical header.
 * Present fields are never replaced; the complete historical transaction digest still has to match. */
export function consumedApprovalTimestamp(input, op) {
    assertConsumedBurnIdentity(op);
    const { finalityTag: _tag, finalityBlockHash: _head, finalityBlockNumberAtomic: _number, ...savedBody } = op.effects[0].proof;
    if (hashObject(savedBody) !== "b9af6f9f65b2fc0f3ac51f3cad9fa47c9411824c4dd646715b5dde0edba4827b")
        circleBlocked("consumed_approval_timestamp_saved_identity");
    const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock), check = circleRecord(input.recheckedBlock);
    const hash = op.effects[0].transactionHash, timestamp = circleUint(b.timestamp), index = circleUint(t.transactionIndex);
    if (input.chainId !== 42161 || input.finalityTag !== "finalized" || timestamp === 0n || circleUint(check.timestamp) !== timestamp ||
        circleHex(b.hash, 32) !== APPROVAL_BLOCK || circleHex(check.hash, 32) !== APPROVAL_BLOCK || circleUint(b.number) !== 513140851n || circleUint(check.number) !== 513140851n ||
        circleHex(t.hash, 32) !== hash || circleHex(r.transactionHash, 32) !== hash || circleHex(t.blockHash, 32) !== APPROVAL_BLOCK || circleHex(r.blockHash, 32) !== APPROVAL_BLOCK ||
        circleUint(t.blockNumber) !== 513140851n || circleUint(r.blockNumber) !== 513140851n || circleUint(r.transactionIndex) !== index ||
        !Array.isArray(b.transactions) || b.transactions[Number(index)] !== hash || b.transactions.filter(x => x === hash).length !== 1)
        circleBlocked("consumed_approval_timestamp_header_binding");
    const transaction = Object.hasOwn(t, "blockTimestamp") ? t : { ...t, blockTimestamp: "0x" + timestamp.toString(16) };
    if (circleUint(transaction.blockTimestamp) !== timestamp || hashObject(transaction) !== SAVED_TRANSACTION_BINDING || op.effects[0].proof?.transactionHashBinding !== SAVED_TRANSACTION_BINDING)
        circleBlocked("consumed_approval_timestamp_saved_binding");
    return { ...input, transaction };
}
//# sourceMappingURL=consumed-approval-timestamp.js.map