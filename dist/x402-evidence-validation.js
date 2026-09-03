import { canonicalJson, domainHash, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { x402OperationBindingHash } from "./x402-state-model.js";
import { address, allowedRecord, bytes32, canonicalText, exactRecord, hash, mediaType, positive, record, stateCorrupt, timestamp, transactionHash, uint, } from "./x402-state-validation-primitives.js";
export function validateAttempts(value, operation) {
    if (!Array.isArray(value) || value.length > 64)
        stateCorrupt("x402 attempts are invalid.");
    let recoveryCount = 0;
    let previousPersistedAt = -Infinity;
    return value.map((item, index) => {
        const attempt = allowedRecord(item, ["attemptNumber", "purpose", "phase", "requestHeaderHash", "persistedAt"], ["observation"]);
        uint(attempt.attemptNumber);
        if (attempt.attemptNumber !== String(index + 1))
            stateCorrupt("x402 attempt numbers are discontinuous.");
        if (attempt.purpose !== "payment" && attempt.purpose !== "result_recovery")
            stateCorrupt("x402 attempt purpose is invalid.");
        if (attempt.phase !== "pending" && attempt.phase !== "observed" && attempt.phase !== "ambiguous")
            stateCorrupt("x402 attempt phase is invalid.");
        hash(attempt.requestHeaderHash);
        timestamp(attempt.persistedAt);
        const persistedAt = Date.parse(attempt.persistedAt);
        if (persistedAt < previousPersistedAt)
            stateCorrupt("x402 attempt persistence timestamps are not chronological.");
        previousPersistedAt = persistedAt;
        if (attempt.requestHeaderHash !== operation.paymentHeaderHash)
            stateCorrupt("x402 attempt request header is not the frozen payment header.");
        if (attempt.purpose === "result_recovery") {
            recoveryCount += 1;
            if (operation.paymentIdentifier === undefined || recoveryCount > 1)
                stateCorrupt("x402 result recovery attempt is not supported by the frozen operation.");
        }
        if (attempt.phase === "pending" && attempt.observation !== undefined)
            stateCorrupt("x402 pending attempt contains an observation.");
        if (attempt.phase === "observed" && attempt.observation === undefined)
            stateCorrupt("x402 observed attempt lacks an observation.");
        const observation = attempt.observation === undefined ? undefined : validateHttpObservation(attempt.observation, attempt.attemptNumber, attempt.purpose, operation);
        if (observation !== undefined && persistedAt > Date.parse(observation.startedAt)) {
            stateCorrupt("x402 attempt was persisted after its HTTP observation started.");
        }
        return { ...attempt, ...(observation === undefined ? {} : { observation }) };
    });
}
export function validateHttpObservation(value, attemptNumber, purpose, operation) {
    const observation = allowedRecord(value, [
        "attemptNumber", "purpose", "targetHash", "status", "rawHeadersHash", "bodyHash", "bodyByteLength",
        "finalUrlHash", "origin", "selectedIpFamily", "startedAt", "observedAt",
    ], ["paymentRequiredHeaderHash", "paymentResponseHeaderHash", "mediaType"]);
    if (observation.attemptNumber !== attemptNumber || observation.purpose !== purpose)
        stateCorrupt("x402 HTTP observation attempt binding is invalid.");
    uint(observation.attemptNumber);
    uint(observation.status);
    uint(observation.bodyByteLength);
    for (const key of ["targetHash", "rawHeadersHash", "bodyHash", "finalUrlHash", "paymentRequiredHeaderHash", "paymentResponseHeaderHash"]) {
        if (observation[key] !== undefined)
            hash(observation[key]);
    }
    if (observation.mediaType !== undefined)
        mediaType(observation.mediaType);
    if (typeof observation.origin !== "string" || new URL(observation.origin).origin !== observation.origin || !observation.origin.startsWith("https://"))
        stateCorrupt("x402 HTTP observation origin is invalid.");
    const resource = record(operation.resource);
    if (observation.targetHash !== resource.urlHash || observation.finalUrlHash !== resource.urlHash ||
        observation.origin !== resource.origin)
        stateCorrupt("x402 HTTP observation does not bind the frozen resource.");
    if (observation.selectedIpFamily !== "ipv4" && observation.selectedIpFamily !== "ipv6")
        stateCorrupt("x402 HTTP IP family is invalid.");
    timestamp(observation.startedAt);
    timestamp(observation.observedAt);
    if (Date.parse(observation.startedAt) > Date.parse(observation.observedAt))
        stateCorrupt("x402 HTTP observation time is invalid.");
    return observation;
}
export function validateSettlementResponseObservation(value, operation, attempts) {
    const observation = exactRecord(value, ["schemaVersion", "classification", "normalizedCanonicalJson", "paymentResponseHeaderHash", "settlementResponseHash", "httpAttemptNumber", "observedAt"]);
    if (observation.schemaVersion !== "apn.x402.settlement-response.v1")
        stateCorrupt("x402 settlement response version is invalid.");
    if (!["success", "settlement_pending", "failure_with_transaction"].includes(observation.classification))
        stateCorrupt("x402 settlement response classification is invalid.");
    const normalized = canonicalText(observation.normalizedCanonicalJson, 48 * 1024);
    validateNormalizedSettlement(normalized, observation.classification, operation);
    hash(observation.paymentResponseHeaderHash);
    hash(observation.settlementResponseHash);
    uint(observation.httpAttemptNumber);
    timestamp(observation.observedAt);
    const attemptNumber = BigInt(observation.httpAttemptNumber);
    const attempt = attemptNumber > 0n && attemptNumber <= BigInt(Number.MAX_SAFE_INTEGER)
        ? attempts[Number(attemptNumber) - 1]
        : undefined;
    if ((attempt?.purpose !== "payment" && attempt?.purpose !== "result_recovery") || attempt.phase !== "observed" ||
        attempt.observation?.paymentResponseHeaderHash !== observation.paymentResponseHeaderHash)
        stateCorrupt("x402 settlement response does not bind an observed paid HTTP attempt.");
    if (observation.settlementResponseHash !== domainHash("apn.x402.settlement.v1", observation.normalizedCanonicalJson))
        stateCorrupt("x402 settlement response hash is invalid.");
    return observation;
}
export function validateNormalizedSettlement(value, classification, operation) {
    const settlement = allowedRecord(value, ["success", "transaction", "network"], ["errorReason", "payer", "amount", "extensions"]);
    if (settlement.network !== CHAIN_CAIP2)
        stateCorrupt("x402 settlement response network is invalid.");
    transactionHash(settlement.transaction);
    if (settlement.payer !== undefined) {
        address(settlement.payer);
        if (settlement.payer !== operation.wallet)
            stateCorrupt("x402 settlement payer conflicts with the frozen operation.");
    }
    if (settlement.amount !== undefined) {
        uint(settlement.amount);
        if (settlement.amount !== operation.amountAtomic)
            stateCorrupt("x402 settlement amount conflicts with the frozen operation.");
    }
    if (settlement.extensions !== undefined && (!isPlainRecord(settlement.extensions) || Object.keys(settlement.extensions).length !== 0))
        stateCorrupt("x402 settlement response extensions are invalid.");
    if (classification === "success" && (settlement.success !== true || settlement.errorReason !== undefined))
        stateCorrupt("x402 success settlement response is invalid.");
    if (classification === "settlement_pending" && (settlement.success !== false || settlement.errorReason !== "settlement_pending"))
        stateCorrupt("x402 pending settlement response is invalid.");
    if (classification === "failure_with_transaction" && (settlement.success !== false || typeof settlement.errorReason !== "string" || settlement.errorReason.length === 0 ||
        Buffer.byteLength(settlement.errorReason, "utf8") > 512 || settlement.errorReason === "settlement_pending"))
        stateCorrupt("x402 failed settlement response is invalid.");
}
export function validateTransactionHint(value) {
    const hint = exactRecord(value, ["transactionHash", "source", "sourceBindingHash", "observedAt"]);
    transactionHash(hint.transactionHash);
    if (hint.source !== "payment_response" && hint.source !== "authorization_used_log")
        stateCorrupt("x402 transaction hint source is invalid.");
    hash(hint.sourceBindingHash);
    timestamp(hint.observedAt);
    return hint;
}
export function validateTransferMethodEvidence(method, transactionHint, authorizationUsedScan, settlementEvidence, unusedExpiryEvidence) {
    if (method === "erc7710") {
        if (authorizationUsedScan !== undefined || unusedExpiryEvidence !== undefined ||
            transactionHint?.source === "authorization_used_log" ||
            settlementEvidence !== undefined && settlementEvidence.schemaVersion !== "apn.x402.erc7710-settlement-evidence.v1") {
            stateCorrupt("x402 ERC-7710 operation contains EIP-3009-only evidence.");
        }
        return;
    }
    if (settlementEvidence !== undefined && settlementEvidence.schemaVersion !== "apn.x402.settlement-evidence.v1") {
        stateCorrupt("x402 EIP-3009 operation contains ERC-7710 settlement evidence.");
    }
}
export function validateAuthorizationUsedScan(value, operation) {
    const scan = allowedRecord(value, ["schemaVersion", "searchStartBlock", "nextFromBlock", "targetSafeHead", "candidates", "status", "updatedAt", "evidenceHash"], ["lastCompletedChunk", "unavailableReason"]);
    if (scan.schemaVersion !== "apn.x402.authorization-used-scan.v1")
        stateCorrupt("x402 authorization-used scan version is invalid.");
    uint(scan.searchStartBlock);
    uint(scan.nextFromBlock);
    const preparedBlock = record(operation.preparedBlock);
    const authorization = record(operation.authorization);
    if (scan.searchStartBlock !== preparedBlock.number)
        stateCorrupt("x402 authorization-used scan start is not the frozen exposure start.");
    const safeHead = exactRecord(scan.targetSafeHead, ["number", "hash", "observedAt"]);
    uint(safeHead.number);
    bytes32(safeHead.hash);
    timestamp(safeHead.observedAt);
    const start = BigInt(scan.searchStartBlock);
    const next = BigInt(scan.nextFromBlock);
    const head = BigInt(safeHead.number);
    if (head < start || next < start || next > head + 1n)
        stateCorrupt("x402 authorization-used scan cursor is outside the frozen range.");
    let completedTo;
    if (scan.lastCompletedChunk !== undefined) {
        const chunk = exactRecord(scan.lastCompletedChunk, ["fromBlock", "toBlock", "toBlockHash"]);
        uint(chunk.fromBlock);
        uint(chunk.toBlock);
        bytes32(chunk.toBlockHash);
        const from = BigInt(chunk.fromBlock);
        const to = BigInt(chunk.toBlock);
        if (from < start || from > to || to > head || to - from + 1n > 2048n || next !== to + 1n)
            stateCorrupt("x402 authorization-used chunk is invalid.");
        if (to === head && chunk.toBlockHash !== safeHead.hash)
            stateCorrupt("x402 authorization-used terminal chunk hash is invalid.");
        completedTo = to;
    }
    else if (next !== start) {
        stateCorrupt("x402 authorization-used cursor advanced without a completed chunk.");
    }
    if (!Array.isArray(scan.candidates) || scan.candidates.length > 2)
        stateCorrupt("x402 authorization-used candidates are invalid.");
    const candidateKeys = new Set();
    for (const item of scan.candidates) {
        const candidate = exactRecord(item, ["blockNumber", "blockHash", "transactionHash", "logIndex", "authorizer", "nonce"]);
        uint(candidate.blockNumber);
        bytes32(candidate.blockHash);
        transactionHash(candidate.transactionHash);
        uint(candidate.logIndex);
        address(candidate.authorizer);
        bytes32(candidate.nonce);
        const candidateBlock = BigInt(candidate.blockNumber);
        if (candidate.authorizer !== operation.wallet || candidate.nonce !== authorization.nonce || completedTo === undefined ||
            candidateBlock < start || candidateBlock > completedTo)
            stateCorrupt("x402 authorization-used candidate does not bind the frozen operation and committed range.");
        const completedChunk = scan.lastCompletedChunk === undefined ? undefined : record(scan.lastCompletedChunk);
        if ((candidateBlock === head && candidate.blockHash !== safeHead.hash) ||
            (completedChunk !== undefined && candidate.blockNumber === completedChunk.toBlock && candidate.blockHash !== completedChunk.toBlockHash))
            stateCorrupt("x402 authorization-used candidate block hash conflicts with validated range evidence.");
        const key = `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`;
        if (candidateKeys.has(key))
            stateCorrupt("x402 authorization-used candidates are not deduplicated.");
        candidateKeys.add(key);
    }
    if (!["active", "complete", "unavailable", "ambiguous"].includes(scan.status))
        stateCorrupt("x402 authorization-used scan status is invalid.");
    if ((scan.status === "unavailable") !== (scan.unavailableReason === "pruned" || scan.unavailableReason === "range_unavailable"))
        stateCorrupt("x402 authorization-used unavailable reason is invalid.");
    if (scan.status === "active" && (scan.candidates.length > 1 || next > head))
        stateCorrupt("x402 active authorization-used scan is invalid.");
    if (scan.status === "complete" && (scan.candidates.length > 1 || completedTo === undefined || next !== head + 1n))
        stateCorrupt("x402 complete authorization-used scan is invalid.");
    if (scan.status === "ambiguous" && (scan.candidates.length !== 2 || completedTo === undefined))
        stateCorrupt("x402 ambiguous authorization-used scan is invalid.");
    if (scan.status === "unavailable" && scan.candidates.length > 1)
        stateCorrupt("x402 unavailable authorization-used scan is invalid.");
    timestamp(scan.updatedAt);
    hash(scan.evidenceHash);
    const { evidenceHash: _hash, ...body } = scan;
    if (scan.evidenceHash !== domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(body)))
        stateCorrupt("x402 authorization-used scan hash is invalid.");
    return scan;
}
export function validateSettlementEvidence(value, operation) {
    const candidate = record(value);
    return candidate.schemaVersion === "apn.x402.erc7710-settlement-evidence.v1"
        ? validateErc7710SettlementEvidence(candidate, operation)
        : validateEip3009SettlementEvidence(candidate, operation);
}
function validateEip3009SettlementEvidence(value, operation) {
    const evidence = exactRecord(value, [
        "schemaVersion", "network", "chainId", "token", "transactionHash", "safeHead", "transactionBlock", "receiptStatus",
        "blockHashRechecked", "authorizationUsed", "transfer", "authorizationState", "rpcOriginHash", "evidenceHash",
    ]);
    if (evidence.schemaVersion !== "apn.x402.settlement-evidence.v1" || evidence.network !== CHAIN_CAIP2 || evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase())
        stateCorrupt("x402 settlement evidence discriminant is invalid.");
    transactionHash(evidence.transactionHash);
    const safeHead = exactRecord(evidence.safeHead, ["number", "hash", "observedAt"]);
    positive(safeHead.number);
    bytes32(safeHead.hash);
    timestamp(safeHead.observedAt);
    const transactionBlock = exactRecord(evidence.transactionBlock, ["number", "hash", "timestamp"]);
    positive(transactionBlock.number);
    bytes32(transactionBlock.hash);
    uint(transactionBlock.timestamp);
    if (BigInt(transactionBlock.number) > BigInt(safeHead.number))
        stateCorrupt("x402 settlement block is newer than the safe head.");
    if (evidence.receiptStatus !== "1" || evidence.blockHashRechecked !== true)
        stateCorrupt("x402 settlement receipt proof is invalid.");
    const used = exactRecord(evidence.authorizationUsed, ["logIndex", "authorizer", "nonce", "blockNumber", "blockHash", "transactionHash"]);
    uint(used.logIndex);
    address(used.authorizer);
    bytes32(used.nonce);
    positive(used.blockNumber);
    bytes32(used.blockHash);
    transactionHash(used.transactionHash);
    const transfer = exactRecord(evidence.transfer, ["logIndex", "from", "to", "value", "blockNumber", "blockHash", "transactionHash"]);
    uint(transfer.logIndex);
    address(transfer.from);
    address(transfer.to);
    positive(transfer.value);
    positive(transfer.blockNumber);
    bytes32(transfer.blockHash);
    transactionHash(transfer.transactionHash);
    for (const member of [used, transfer]) {
        if (member.blockNumber !== transactionBlock.number || member.blockHash !== transactionBlock.hash || member.transactionHash !== evidence.transactionHash)
            stateCorrupt("x402 settlement log binding is invalid.");
    }
    if (operation !== undefined) {
        const authorization = record(operation.authorization);
        if (used.authorizer !== operation.wallet || used.nonce !== authorization.nonce)
            stateCorrupt("x402 authorization-used evidence conflicts with the frozen authorization.");
        if (transfer.from !== operation.wallet || transfer.to !== operation.payee || transfer.value !== operation.amountAtomic)
            stateCorrupt("x402 transfer evidence conflicts with the frozen economics.");
    }
    const authorizationState = exactRecord(evidence.authorizationState, ["value", "blockNumber", "blockHash", "blockTag", "observedAt"]);
    if (authorizationState.value !== true || (authorizationState.blockTag !== "safe" && authorizationState.blockTag !== "number"))
        stateCorrupt("x402 settlement authorization state is invalid.");
    positive(authorizationState.blockNumber);
    bytes32(authorizationState.blockHash);
    timestamp(authorizationState.observedAt);
    const authorizationBlock = BigInt(authorizationState.blockNumber);
    if (authorizationBlock < BigInt(transactionBlock.number) || authorizationBlock > BigInt(safeHead.number))
        stateCorrupt("x402 authorization-state block is outside the safe settlement range.");
    if (authorizationState.blockTag === "safe" && (authorizationState.blockNumber !== safeHead.number || authorizationState.blockHash !== safeHead.hash))
        stateCorrupt("x402 safe-tag authorization state does not bind the safe head.");
    const transactionIdentity = { number: transactionBlock.number, hash: transactionBlock.hash };
    const safeIdentity = { number: safeHead.number, hash: safeHead.hash };
    const authorizationIdentity = { number: authorizationState.blockNumber, hash: authorizationState.blockHash };
    for (const [left, right] of [
        [transactionIdentity, safeIdentity],
        [transactionIdentity, authorizationIdentity],
        [safeIdentity, authorizationIdentity],
    ]) {
        if (left.number === right.number && left.hash !== right.hash)
            stateCorrupt("x402 equal block numbers have conflicting hashes.");
    }
    hash(evidence.rpcOriginHash);
    hash(evidence.evidenceHash);
    const { evidenceHash: _hash, ...body } = evidence;
    if (evidence.evidenceHash !== domainHash("apn.x402.settlement-evidence.v1", canonicalJson(body)))
        stateCorrupt("x402 settlement evidence hash is invalid.");
    return evidence;
}
function validateErc7710SettlementEvidence(value, operation) {
    const evidence = exactRecord(value, [
        "schemaVersion", "network", "chainId", "token", "transactionHash", "safeHead", "transactionBlock",
        "receiptStatus", "blockHashRechecked", "transfer", "methodBinding", "rpcOriginHash", "evidenceHash",
    ]);
    if (evidence.schemaVersion !== "apn.x402.erc7710-settlement-evidence.v1" || evidence.network !== CHAIN_CAIP2 ||
        evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase() || evidence.receiptStatus !== "1" ||
        evidence.blockHashRechecked !== true)
        stateCorrupt("x402 ERC-7710 settlement discriminant is invalid.");
    transactionHash(evidence.transactionHash);
    const safeHead = exactRecord(evidence.safeHead, ["number", "hash", "observedAt"]);
    positive(safeHead.number);
    bytes32(safeHead.hash);
    timestamp(safeHead.observedAt);
    const transactionBlock = exactRecord(evidence.transactionBlock, ["number", "hash", "timestamp"]);
    positive(transactionBlock.number);
    bytes32(transactionBlock.hash);
    uint(transactionBlock.timestamp);
    if (BigInt(transactionBlock.number) > BigInt(safeHead.number)) {
        stateCorrupt("x402 ERC-7710 settlement block is newer than the safe head.");
    }
    if (transactionBlock.number === safeHead.number && transactionBlock.hash !== safeHead.hash) {
        stateCorrupt("x402 ERC-7710 settlement block conflicts with the safe head.");
    }
    const transfer = exactRecord(evidence.transfer, ["logIndex", "from", "to", "value", "blockNumber", "blockHash", "transactionHash"]);
    uint(transfer.logIndex);
    address(transfer.from);
    address(transfer.to);
    positive(transfer.value);
    positive(transfer.blockNumber);
    bytes32(transfer.blockHash);
    transactionHash(transfer.transactionHash);
    if (transfer.blockNumber !== transactionBlock.number || transfer.blockHash !== transactionBlock.hash ||
        transfer.transactionHash !== evidence.transactionHash)
        stateCorrupt("x402 ERC-7710 transfer log binding is invalid.");
    const binding = exactRecord(evidence.methodBinding, [
        "paymentResponseHash", "operationBindingHash", "offerHash", "method", "delegationManager", "delegator",
        "childHash", "permissionContextHash",
    ]);
    if (binding.method !== "erc7710")
        stateCorrupt("x402 ERC-7710 method binding is invalid.");
    hash(binding.paymentResponseHash);
    hash(binding.operationBindingHash);
    hash(binding.offerHash);
    address(binding.delegationManager);
    address(binding.delegator);
    hash(binding.childHash);
    hash(binding.permissionContextHash);
    if (operation !== undefined) {
        const delegated = record(operation.delegatedMaterial);
        const offer = record(operation.selectedOffer);
        const response = record(operation.settlementResponseObservation);
        if (transfer.from !== operation.wallet || transfer.to !== operation.payee || transfer.value !== operation.amountAtomic ||
            binding.paymentResponseHash !== response.settlementResponseHash || binding.offerHash !== offer.offerHash ||
            binding.delegationManager !== delegated.delegationManager || binding.delegator !== operation.wallet ||
            binding.childHash !== operation.signatureHash || binding.permissionContextHash !== operation.paymentContextHash ||
            evidence.rpcOriginHash !== delegated.rpcOriginHash ||
            binding.operationBindingHash !== x402OperationBindingHash(operation)) {
            stateCorrupt("x402 ERC-7710 evidence conflicts with the frozen operation.");
        }
    }
    hash(evidence.rpcOriginHash);
    hash(evidence.evidenceHash);
    const { evidenceHash: _hash, ...body } = evidence;
    if (evidence.evidenceHash !== domainHash("apn.x402.erc7710-settlement-evidence.v1", canonicalJson(body))) {
        stateCorrupt("x402 ERC-7710 settlement evidence hash is invalid.");
    }
    return evidence;
}
export function validateUnusedExpiryEvidence(value, operation) {
    const evidence = exactRecord(value, ["schemaVersion", "network", "chainId", "token", "validBefore", "finalizedHead", "authorizationState", "absence", "rpcOriginHash", "evidenceHash"]);
    if (evidence.schemaVersion !== "apn.x402.unused-expiry-evidence.v1" || evidence.network !== CHAIN_CAIP2 || evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase())
        stateCorrupt("x402 unused-expiry evidence discriminant is invalid.");
    uint(evidence.validBefore);
    const finalizedHead = exactRecord(evidence.finalizedHead, ["number", "hash", "timestamp", "observedAt"]);
    positive(finalizedHead.number);
    bytes32(finalizedHead.hash);
    uint(finalizedHead.timestamp);
    timestamp(finalizedHead.observedAt);
    if (BigInt(finalizedHead.timestamp) < BigInt(evidence.validBefore))
        stateCorrupt("x402 unused-expiry head precedes authorization expiry.");
    const authorizationState = exactRecord(evidence.authorizationState, ["value", "blockNumber", "blockHash", "blockTag", "observedAt"]);
    if (authorizationState.value !== false || authorizationState.blockTag !== "finalized")
        stateCorrupt("x402 unused-expiry authorization state is invalid.");
    positive(authorizationState.blockNumber);
    bytes32(authorizationState.blockHash);
    timestamp(authorizationState.observedAt);
    if (operation !== undefined && (evidence.validBefore !== record(operation.authorization).validBefore ||
        authorizationState.blockNumber !== finalizedHead.number || authorizationState.blockHash !== finalizedHead.hash))
        stateCorrupt("x402 unused-expiry evidence conflicts with the frozen authorization or finalized head.");
    const absence = exactRecord(evidence.absence, ["localSettlement", "httpSettlement", "authorizationUsed", "transactionReceipt"]);
    if (Object.values(absence).some((item) => item !== false))
        stateCorrupt("x402 unused-expiry absence proof is invalid.");
    hash(evidence.rpcOriginHash);
    hash(evidence.evidenceHash);
    const { evidenceHash: _hash, ...body } = evidence;
    if (evidence.evidenceHash !== domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(body)))
        stateCorrupt("x402 unused-expiry evidence hash is invalid.");
    return evidence;
}
//# sourceMappingURL=x402-evidence-validation.js.map