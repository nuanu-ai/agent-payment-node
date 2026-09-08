import { canonicalJson, sha256 } from "../canonical.js";
import { atomic } from "../chain-policy.js";
import { validateRailEvidence } from "../rail-operation-model.js";
import { readTronAccount, requireTronUsdt, tronUsdtBalance } from "./accounts.js";
import { TRON_GENESIS, TRON_TRANSFER_TOPIC, TRON_USDT_HEX, tronArray, tronAtomic, tronHash, tronProtocolFailure, tronRecord, tronSafeNumber, tronWord } from "./codec.js";
import { assertTronNetwork, tronBlock } from "./rpc.js";
import { unsignedTronPrepared, validateTronChainTransaction } from "./transaction.js";
export async function inspectTron(rpc, account, prepared, transactionId, expectedRawPayloadHash, now) {
    try {
        return await inspect(rpc, account, prepared, transactionId, expectedRawPayloadHash, now);
    }
    catch {
        return { status: "unproven", reason: "solidified_transaction_effect_not_proven" };
    }
}
async function inspect(rpc, account, prepared, transactionId, expectedRawPayloadHash, now) {
    await assertTronNetwork(rpc);
    tronHash(transactionId);
    if (account.address !== prepared.sender || unsignedTronPrepared(prepared).txID !== transactionId)
        tronProtocolFailure();
    const body = tronRecord(await rpc.call("walletsolidity/gettransactionbyid", { value: transactionId }));
    const info = tronRecord(await rpc.call("walletsolidity/gettransactioninfobyid", { value: transactionId }));
    if (Object.keys(body).length === 0 || Object.keys(info).length === 0)
        return { status: "pending", reason: "solidified_history_absent" };
    const signed = validateTronChainTransaction(body, prepared);
    if (sha256(canonicalJson(signed)) !== expectedRawPayloadHash)
        tronProtocolFailure();
    if (info.id !== transactionId)
        tronProtocolFailure();
    const blockNumber = tronAtomic(info.blockNumber);
    const block = tronBlock(await rpc.call("walletsolidity/getblockbynum", { num: tronSafeNumber(blockNumber) }));
    if (block.number !== blockNumber || tronAtomic(info.blockTimeStamp) !== block.timestamp)
        tronProtocolFailure();
    const snapshot = prepared.resources;
    if (snapshot === undefined || blockNumber <= atomic(snapshot.referenceBlockNumberAtomic))
        tronProtocolFailure();
    const parentHash = tronHash(tronRecord(tronRecord(block.body.block_header).raw_data).parentHash);
    const parent = tronBlock(await rpc.call("walletsolidity/getblockbynum", { num: tronSafeNumber(blockNumber - 1n) }));
    // Consensus checks expiration against the previous head. A first block after
    // missed slots can cross maintenance and still execute at the old prices.
    if (parent.number + 1n !== blockNumber || parent.id !== parentHash || parent.timestamp + 3000n > block.timestamp ||
        parent.timestamp < atomic(snapshot.referenceTimestampMsAtomic) || parent.timestamp + 3000n > atomic(snapshot.expirationMsAtomic) ||
        parent.number === atomic(snapshot.referenceBlockNumberAtomic) && parent.id !== snapshot.referenceBlockId)
        tronProtocolFailure();
    const members = tronArray(block.body.transactions, 4000).map(tronRecord).filter((item) => item.txID === transactionId);
    if (members.length !== 1 || canonicalJson(validateTronChainTransaction(members[0], prepared)) !== canonicalJson(signed))
        tronProtocolFailure();
    const ret = resultRow(body);
    const blockRet = resultRow(members[0]);
    if (canonicalJson(ret) !== canonicalJson(blockRet))
        tronProtocolFailure();
    const receipt = tronRecord(info.receipt);
    const overall = zeroEnum(info.result, "SUCESS");
    const transactionOverall = zeroEnum(ret.ret, "SUCESS");
    const contractResult = ret.contractRet;
    const vmResult = zeroEnum(receipt.result, "DEFAULT");
    const success = overall === "SUCESS" && transactionOverall === "SUCESS" && contractResult === "SUCCESS" && vmResult === (prepared.asset.kind === "native" ? "DEFAULT" : "SUCCESS");
    const reverted = prepared.asset.kind === "token" && overall === "FAILED" && transactionOverall === "SUCESS" && contractResult === "REVERT" && vmResult === "REVERT";
    if (!success && !reverted || success && info.resMessage !== undefined && info.resMessage !== "")
        tronProtocolFailure();
    if (prepared.asset.kind === "token") {
        await requireTronUsdt(rpc);
        if (info.contract_address !== undefined && info.contract_address !== "" && info.contract_address !== TRON_USDT_HEX)
            tronProtocolFailure();
        const logs = info.log === undefined ? [] : tronArray(info.log, 32);
        if (success) {
            if (logs.length !== 1)
                tronProtocolFailure();
            const log = tronRecord(logs[0]);
            const topics = tronArray(log.topics, 3);
            if (log.address !== TRON_USDT_HEX.slice(2) || topics.length !== 3 || topics[0] !== TRON_TRANSFER_TOPIC || topics[1] !== tronWord(prepared.sender) || topics[2] !== tronWord(prepared.recipient) || log.data !== atomic(prepared.amountAtomic).toString(16).padStart(64, "0"))
                tronProtocolFailure();
        }
        else if (logs.length !== 0)
            tronProtocolFailure();
    }
    else if (info.log !== undefined && tronArray(info.log).length !== 0)
        tronProtocolFailure();
    const head = tronBlock(await rpc.call("walletsolidity/getnowblock", {}));
    if (head.number < blockNumber || head.timestamp < block.timestamp)
        tronProtocolFailure();
    const native = prepared.asset.kind === "native";
    const senderBalance = native ? (await readTronAccount(rpc, prepared.sender, true)).balance : await tronUsdtBalance(rpc, prepared.sender, true);
    const recipientBalance = native ? (await readTronAccount(rpc, prepared.recipient, true)).balance : await tronUsdtBalance(rpc, prepared.recipient, true);
    const total = tronAtomic(info.fee, true);
    const net = tronAtomic(receipt.net_fee, true);
    const energy = tronAtomic(receipt.energy_fee, true);
    if (total < net + energy)
        tronProtocolFailure();
    const resources = { schemaVersion: "apn.tron-resource-evidence.v1", parentBlockId: parent.id, parentBlockNumberAtomic: parent.number.toString(),
        parentTimestampMsAtomic: parent.timestamp.toString(), blockTimestampMsAtomic: block.timestamp.toString(),
        totalFeeAtomic: total.toString(), bandwidthFeeAtomic: net.toString(), bandwidthUsageAtomic: tronAtomic(receipt.net_usage, true).toString(),
        energyFeeAtomic: energy.toString(), energyUsageAtomic: tronAtomic(receipt.energy_usage, true).toString(), originEnergyUsageAtomic: tronAtomic(receipt.origin_energy_usage, true).toString(),
        totalEnergyUsageAtomic: tronAtomic(receipt.energy_usage_total, true).toString(), accountActivationFeeAtomic: (total - net - energy).toString(), contractResult: success ? "SUCCESS" : "REVERT",
        balanceObservation: { scope: "current_solidified_state", atOrAfterBlockNumberAtomic: head.number.toString(), senderBalanceAtomic: senderBalance.toString(), recipientBalanceAtomic: recipientBalance.toString() } };
    const evidence = { networkIdentity: TRON_GENESIS, transactionId, blockNumberAtomic: block.number.toString(), blockId: block.id, finality: "solidified",
        sender: prepared.sender, recipient: prepared.recipient, assetIdentifier: prepared.asset.identifier, amountAtomic: prepared.amountAtomic, actualNetworkFeeAtomic: total.toString(), actualRecipientRentAtomic: "0",
        networkFeePayer: prepared.sender, senderEffectVerified: success, recipientEffectVerified: success, transactionVerified: true, observedAt: now.toISOString(), rpcOriginHash: rpc.originHash, resources };
    validateRailEvidence(evidence, prepared, transactionId, success);
    return { status: success ? "completed" : "failed_confirmed_revert", reason: success ? "exact_solidified_transfer_verified" : "exact_solidified_revert_verified", proofClass: "tron_solidified_transaction_effect", evidence };
}
function resultRow(value) {
    const rows = tronArray(tronRecord(value).ret, 1);
    if (rows.length !== 1)
        tronProtocolFailure();
    const row = tronRecord(rows[0]);
    if (Object.keys(row).some((key) => !["contractRet", "ret", "fee"].includes(key)))
        tronProtocolFailure();
    return { contractRet: row.contractRet, ret: zeroEnum(row.ret, "SUCESS"), fee: tronAtomic(row.fee, true).toString() };
}
function zeroEnum(value, zero) { return value === undefined || value === 0 || value === 0n ? zero : value; }
//# sourceMappingURL=evidence.js.map