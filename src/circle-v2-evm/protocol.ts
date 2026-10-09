/** Finite CCTP V2 Fast codecs. Pure caller-supplied chain observations are not RPC authenticity proof.
 * Wire layouts/signatures: circlefin/evm-cctp-contracts commit 6e7513cdb2bee6bb0cddf331fe972600fc5017c9. */
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, encodeEventTopics, getAddress, keccak256, parseAbi,
  recoverAddress, toEventSelector, type Address, type Hex } from "viem";
import { hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { CIRCLE_AMOUNT, CIRCLE_MAX_FEE, CIRCLE_MIN_MINT, CIRCLE_MESSENGER, CIRCLE_RECIPIENT, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN,
  CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
export const CIRCLE_ZERO = `0x${"00".repeat(32)}` as Hex;
export const CIRCLE_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns(bool)",
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)",
  "function receiveMessage(bytes message,bytes attestation) returns(bool)",
  "event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)",
  "event MessageSent(bytes message)",
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
  "event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
export function circleFail(reason: string): never { throw new ApnError("APN_RPC_PROTOCOL", `circle_evm_${reason}`); }
export function circleRecord(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) circleFail("shape"); return value; }
export function circleHex(value: unknown, bytes?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(value) || value.length > 32_770 ||
    bytes !== undefined && value.length !== 2 + bytes * 2) circleFail("hex"); return value.toLowerCase() as Hex;
}
export function circleUint(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-fA-F][a-fA-F0-9]*))$/u.test(value) || value.length > 80) circleFail("quantity");
  return BigInt(value);
}
export const circleWord = (address: string): Hex => `0x${"0".repeat(24)}${getAddress(address).slice(2).toLowerCase()}`;
const slice = (m: Hex, start: number, length: number): Hex => `0x${m.slice(2 + start * 2, 2 + (start + length) * 2)}`;
export function encodeCircleApproval(reset = false): Hex { return encodeFunctionData({ abi: CIRCLE_ABI,
  functionName: "approve", args: [CIRCLE_MESSENGER, reset ? 0n : CIRCLE_AMOUNT] }); }
export function encodeCircleBurn(chain: CircleDestinationChain): Hex { return encodeFunctionData({ abi: CIRCLE_ABI,
  functionName: "depositForBurn", args: [CIRCLE_AMOUNT, circleRoute(chain).domain, circleWord(CIRCLE_RECIPIENT), CIRCLE_SOURCE_TOKEN, CIRCLE_ZERO, CIRCLE_MAX_FEE, 1000] }); }
export interface CircleMessage { readonly bytes: Hex; readonly hash: Hex; readonly nonce: Hex; readonly body: Hex;
  readonly destinationChain: CircleDestinationChain; readonly finalityExecuted: number; readonly expirationBlock: string; readonly feeExecutedAtomic: string; readonly receivedAtomic: string; }
export function decodeCircleMessage(value: unknown, chain: CircleDestinationChain, attested: boolean): CircleMessage {
  const m = circleHex(value, 376), route = circleRoute(chain), u = (start: number, width: number) => BigInt(slice(m, start, width));
  if (u(0, 4) !== 1n || u(4, 4) !== 3n || u(8, 4) !== BigInt(route.domain) ||
    slice(m, 44, 32) !== circleWord(CIRCLE_MESSENGER) || slice(m, 76, 32) !== circleWord(CIRCLE_MESSENGER) ||
    slice(m, 108, 32) !== CIRCLE_ZERO || u(140, 4) !== 1000n || u(148, 4) !== 1n ||
    slice(m, 152, 32) !== circleWord(CIRCLE_SOURCE_TOKEN) || slice(m, 184, 32) !== circleWord(CIRCLE_RECIPIENT) ||
    u(216, 32) !== CIRCLE_AMOUNT || slice(m, 248, 32) !== circleWord(CIRCLE_SOURCE_OWNER) ||
    u(280, 32) !== CIRCLE_MAX_FEE || u(312, 32) > CIRCLE_MAX_FEE) circleFail("message_binding");
  if (CIRCLE_AMOUNT - u(312, 32) < CIRCLE_MIN_MINT) circleFail("mint_floor");
  const nonce = slice(m, 12, 32), executed = Number(u(144, 4)), expiration = u(344, 32);
  if (attested ? nonce === CIRCLE_ZERO || ![1000, 2000].includes(executed) : nonce !== CIRCLE_ZERO || executed !== 0 || expiration !== 0n || u(312, 32) !== 0n) circleFail("message_finality_nonce");
  return { bytes: m, hash: keccak256(m), nonce, body: slice(m, 148, 228), destinationChain: chain,
    finalityExecuted: executed, expirationBlock: expiration.toString(), feeExecutedAtomic: u(312, 32).toString(), receivedAtomic: (CIRCLE_AMOUNT - u(312, 32)).toString() };
}
/** The caller must read chain ID, receipt, canonical included block and finality head independently and recheck the included block. */
export interface CircleObservation { readonly transaction: unknown; readonly receipt: unknown;
  readonly canonicalBlock: unknown; readonly recheckedBlock: unknown; readonly finalityHead: unknown;
  readonly chainId: number; readonly finalityTag: "included" | "safe" | "finalized"; }
export interface CircleReceiptProof { readonly transactionHash: Hex; readonly blockHash: Hex; readonly blockNumberAtomic: string;
  readonly finalityBlockHash: Hex; readonly finalityBlockNumberAtomic: string; readonly transactionHashBinding: string;
  readonly finalityTag: "included" | "safe" | "finalized"; readonly receiptHash: string; readonly logsHash: string; readonly actualFeeAtomic: string; }
function addressEquals(value: unknown, address: Address): boolean { try { return typeof value === "string" && getAddress(value) === address; } catch { return false; } }
export function verifyCircleObservation(input: CircleObservation, expected: { chain: number; from: Address; to: Address; data: Hex;
  transactionHash?: Hex; maxNativeDebitAtomic: bigint; maxGasAtomic: bigint }): CircleReceiptProof {
  const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock),
    recheck = circleRecord(input.recheckedBlock), head = circleRecord(input.finalityHead);
  const txHash = circleHex(t.hash, 32), blockHash = circleHex(b.hash, 32), number = circleUint(b.number), gas = circleUint(t.gas), used = circleUint(r.gasUsed), price = circleUint(r.effectiveGasPrice);
  if (input.chainId !== expected.chain || circleUint(t.chainId) !== BigInt(expected.chain) ||
    (expected.chain === 42161 ? !["included", "finalized"].includes(input.finalityTag) : input.finalityTag !== "safe") || txHash === CIRCLE_ZERO || blockHash === CIRCLE_ZERO ||
    expected.transactionHash !== undefined && txHash !== expected.transactionHash ||
    !addressEquals(t.from, expected.from) || !addressEquals(t.to, expected.to) || circleHex(t.input) !== expected.data ||
    circleUint(t.value) !== 0n || circleHex(t.blockHash, 32) !== blockHash || circleUint(t.blockNumber) !== number ||
    circleHex(r.transactionHash, 32) !== txHash || circleUint(r.status) !== 1n || circleHex(r.blockHash, 32) !== blockHash ||
    circleUint(r.blockNumber) !== number || !addressEquals(r.from, expected.from) || !addressEquals(r.to, expected.to) ||
    circleHex(recheck.hash, 32) !== blockHash || circleUint(recheck.number) !== number ||
    circleUint(head.number) < number || circleHex(head.hash, 32) === CIRCLE_ZERO ||
    !Array.isArray(b.transactions) || b.transactions.filter(x => typeof x === "string" && x.toLowerCase() === txHash).length !== 1 ||
    gas === 0n || gas > expected.maxGasAtomic || used > gas || price > circleUint(t.maxFeePerGas)) circleFail("transaction_finality_binding");
  const fee = (expected.chain === 143 ? gas : used) * price;
  // These finite chains account for native execution in effectiveGasPrice; unknown extra fee fields fail closed.
  for (const field of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"]) if (r[field] !== undefined && circleUint(r[field]) !== 0n) circleFail("unmodeled_fee");
  if (fee > expected.maxNativeDebitAtomic) circleFail("native_fee_cap");
  if (!Array.isArray(r.logs) || r.logs.length > 64) circleFail("logs_shape");
  const logIndices = new Set<string>();
  for (const raw of r.logs) {
    const l = circleRecord(raw), index = circleUint(l.logIndex).toString();
    if (logIndices.has(index)) circleFail("duplicate_log_index"); logIndices.add(index);
    if (l.removed === true || circleHex(l.transactionHash, 32) !== txHash || circleHex(l.blockHash, 32) !== blockHash ||
      circleUint(l.blockNumber) !== number) circleFail("log_receipt_membership");
  }
  return { transactionHash: txHash, blockHash, blockNumberAtomic: number.toString(), finalityBlockHash: circleHex(head.hash, 32),
    finalityBlockNumberAtomic: circleUint(head.number).toString(), transactionHashBinding: hashObject(t), finalityTag: input.finalityTag, receiptHash: hashObject(r),
    logsHash: hashObject(r.logs), actualFeeAtomic: fee.toString() };
}
function oneEvent(observation: CircleObservation, name: "DepositForBurn" | "MessageSent" | "MessageReceived" | "MintAndWithdraw" | "Transfer" | "Approval", emitter: Address) {
  const logs = circleRecord(observation.receipt).logs as unknown[], event = CIRCLE_ABI.find(x => x.type === "event" && x.name === name)!;
  const matching = logs.map(circleRecord).filter(l => addressEquals(l.address, emitter) && Array.isArray(l.topics) && circleHex(l.topics[0], 32) === toEventSelector(event));
  if (matching.length !== 1) circleFail("event_count"); const log = matching[0]!;
  const topics = (log.topics as unknown[]).map(x => circleHex(x, 32)) as [Hex, ...Hex[]];
  const data = circleHex(log.data), decoded = decodeEventLog({ abi: [event], data, topics, strict: true });
  const args = decoded.args as Record<string, unknown>, unindexed = event.inputs.filter(x => !("indexed" in x && x.indexed));
  const canonicalTopics = encodeEventTopics({ abi: [event], eventName: name as never, args: args as never });
  if (canonicalTopics.length !== topics.length || canonicalTopics.some((value, index) => value !== topics[index])) circleFail("noncanonical_topics");
  if (encodeAbiParameters(unindexed, unindexed.map(x => args[x.name]) as never).toLowerCase() !== data || topics.length !== 1 + event.inputs.filter(x => "indexed" in x && x.indexed).length) circleFail("noncanonical_event");
  return { args, logIndex: circleUint(log.logIndex) };
}
export interface CircleSourceProof extends CircleReceiptProof { readonly kind: "circle_v2_evm_source";
  readonly destinationChain: CircleDestinationChain; readonly sourceMessage: Hex; readonly sourceMessageHash: Hex; readonly integrityHash: string; }
export function decodeCircleSource(input: CircleObservation, chain: CircleDestinationChain): CircleSourceProof {
  const receipt = verifyCircleObservation(input, { chain: 42161, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_MESSENGER,
    data: encodeCircleBurn(chain), maxNativeDebitAtomic: 30_000_000_000_000n, maxGasAtomic: 600_000n });
  const sent = oneEvent(input, "MessageSent", CIRCLE_TRANSMITTER), burn = oneEvent(input, "DepositForBurn", CIRCLE_MESSENGER), args = burn.args;
  const message = decodeCircleMessage(sent.args.message, chain, false);
  if (sent.logIndex >= burn.logIndex || !addressEquals(args.burnToken, CIRCLE_SOURCE_TOKEN) || args.amount !== CIRCLE_AMOUNT ||
    !addressEquals(args.depositor, CIRCLE_SOURCE_OWNER) || circleHex(args.mintRecipient, 32) !== circleWord(CIRCLE_RECIPIENT) ||
    args.destinationDomain !== circleRoute(chain).domain || circleHex(args.destinationTokenMessenger, 32) !== circleWord(CIRCLE_MESSENGER) ||
    circleHex(args.destinationCaller, 32) !== CIRCLE_ZERO || args.maxFee !== CIRCLE_MAX_FEE || args.minFinalityThreshold !== 1000 || args.hookData !== "0x") circleFail("burn_event_binding");
  const body = { kind: "circle_v2_evm_source" as const, ...receipt, destinationChain: chain, sourceMessage: message.bytes, sourceMessageHash: message.hash };
  return { ...body, integrityHash: hashObject(body) };
}
export function assertCircleSource(source: CircleSourceProof): void {
  const { integrityHash, ...body } = source;
  if (integrityHash !== hashObject(body) || source.kind !== "circle_v2_evm_source" || source.transactionHash === CIRCLE_ZERO ||
    decodeCircleMessage(source.sourceMessage, source.destinationChain, false).hash !== source.sourceMessageHash) circleFail("source_integrity");
}
export interface CircleAttesterSnapshot { readonly threshold: number; readonly enabledAttesters: readonly Address[];
  readonly chainId: CircleDestinationChain; readonly transmitter: Address; readonly blockHash: Hex; readonly blockNumberAtomic: string; readonly deploymentDigest: string; }
export interface CircleAttestation extends CircleMessage { readonly kind: "circle_v2_evm_attestation"; readonly attestation: Hex;
  readonly sourceTransactionHash: Hex; readonly sourceMessageHash: Hex; readonly responseHash: string; readonly attesterSnapshotHash: string;
  readonly signers: readonly Address[]; readonly attesterConfigurationHash: string; readonly integrityHash: string; }
/** Config digest deliberately excludes observation block and block-bearing deployment digest. Deployment pins are checked separately. */
export function circleAttesterConfigurationHash(snapshot: CircleAttesterSnapshot): string {
  return hashObject({ chainId: snapshot.chainId, transmitter: snapshot.transmitter, threshold: snapshot.threshold,
    enabledAttesters: snapshot.enabledAttesters.map(x => getAddress(x)).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) });
}
export async function verifyCircleAttestationSigners(message: CircleMessage, attestation: Hex, snapshot: CircleAttesterSnapshot): Promise<readonly Address[]> {
  if (decodeCircleMessage(message.bytes, message.destinationChain, true).hash !== message.hash) circleFail("attested_hash_binding");
  if (snapshot.chainId !== message.destinationChain || snapshot.transmitter !== CIRCLE_TRANSMITTER ||
    !/^[a-f0-9]{64}$/u.test(snapshot.deploymentDigest) || !Number.isSafeInteger(snapshot.threshold) || snapshot.threshold < 1 || snapshot.threshold > 10 ||
    circleHex(snapshot.blockHash, 32) === CIRCLE_ZERO || circleUint(snapshot.blockNumberAtomic) < 1n ||
    snapshot.enabledAttesters.length < snapshot.threshold || snapshot.enabledAttesters.length > 20 ||
    new Set(snapshot.enabledAttesters.map(x => x.toLowerCase())).size !== snapshot.enabledAttesters.length ||
    attestation.length !== 2 + 130 * snapshot.threshold) circleFail("attester_snapshot");
  const signers: Address[] = []; let previous = 0n;
  for (let i = 0; i < snapshot.threshold; i++) {
    const signature = slice(attestation, i * 65, 65), s = BigInt(slice(signature, 32, 32)), v = Number(BigInt(slice(signature, 64, 1)));
    if (![27, 28].includes(v) || s === 0n || s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) circleFail("attestation_signature_canonical");
    const signer = await recoverAddress({ hash: message.hash, signature });
    if (BigInt(signer) <= previous || !snapshot.enabledAttesters.some(x => x.toLowerCase() === signer.toLowerCase())) circleFail("attestation_signer");
    signers.push(signer); previous = BigInt(signer);
  }
  return signers;
}
export async function bindCircleAttestation(source: CircleSourceProof, response: unknown, snapshot: CircleAttesterSnapshot): Promise<CircleAttestation> {
  assertCircleSource(source); const r = circleRecord(response);
  if (circleHex(r.sourceTxHash, 32) !== source.transactionHash || !Array.isArray(r.messages) || r.messages.length !== 1) circleFail("iris_source_binding");
  const entry = circleRecord(r.messages[0]);
  if (entry.cctpVersion !== 2 || entry.status !== "complete") circleFail("iris_status");
  const m = decodeCircleMessage(entry.message, source.destinationChain, true), attestation = circleHex(entry.attestation);
  if (circleHex(entry.eventNonce, 32) !== m.nonce) circleFail("iris_event_nonce_binding");
  // Only nonce, executed finality, bounded feeExecuted and expiration may differ from the source MessageSent bytes.
  for (let i = 0; i < 376; i++) if (!(i >= 12 && i < 44 || i >= 144 && i < 148 || i >= 312 && i < 376) &&
    slice(source.sourceMessage, i, 1) !== slice(m.bytes, i, 1)) circleFail("attested_source_bytes");
  const decoded = circleRecord(entry.decodedMessage), b = circleRecord(decoded.decodedMessageBody);
  const sameWord = (v: unknown, w: Hex) => typeof v === "string" && (v.length === 42 ? circleWord(v) : circleHex(v, 32)) === w;
  if (circleUint(decoded.sourceDomain) !== 3n || circleUint(decoded.destinationDomain) !== BigInt(circleRoute(source.destinationChain).domain) ||
    circleHex(decoded.nonce, 32) !== m.nonce ||
    !sameWord(decoded.sender, circleWord(CIRCLE_MESSENGER)) || !sameWord(decoded.recipient, circleWord(CIRCLE_MESSENGER)) ||
    !sameWord(decoded.destinationCaller, CIRCLE_ZERO) || circleHex(decoded.messageBody) !== m.body ||
    !sameWord(b.burnToken, circleWord(CIRCLE_SOURCE_TOKEN)) || !sameWord(b.mintRecipient, circleWord(CIRCLE_RECIPIENT)) ||
    circleUint(b.amount) !== CIRCLE_AMOUNT || !sameWord(b.messageSender, circleWord(CIRCLE_SOURCE_OWNER))) circleFail("iris_decoded_binding");
  for (const [v, expected] of [[decoded.minFinalityThreshold, 1000n], [decoded.finalityThresholdExecuted, BigInt(m.finalityExecuted)],
    [b.maxFee, CIRCLE_MAX_FEE], [b.feeExecuted, BigInt(m.feeExecutedAtomic)], [b.expirationBlock, BigInt(m.expirationBlock)]] as const) if (v !== undefined && circleUint(v) !== expected) circleFail("iris_decoded_optional");
  if (b.hookData !== undefined && b.hookData !== "0x") circleFail("iris_hook");
  const signers = await verifyCircleAttestationSigners(m, attestation, snapshot);
  const body = { kind: "circle_v2_evm_attestation" as const, ...m, attestation, sourceTransactionHash: source.transactionHash,
    sourceMessageHash: source.sourceMessageHash, responseHash: hashObject(response), attesterSnapshotHash: hashObject(snapshot), signers, attesterConfigurationHash: circleAttesterConfigurationHash(snapshot) };
  return { ...body, integrityHash: hashObject(body) };
}
export function assertCircleAttestation(source: CircleSourceProof, attested: CircleAttestation): void {
  assertCircleSource(source); const { integrityHash, ...body } = attested;
  if (hashObject(body) !== integrityHash || attested.sourceTransactionHash !== source.transactionHash || attested.sourceMessageHash !== source.sourceMessageHash ||
    attested.destinationChain !== source.destinationChain || BigInt(attested.receivedAtomic) < CIRCLE_MIN_MINT) circleFail("attestation_integrity");
  const parsed = decodeCircleMessage(attested.bytes, source.destinationChain, true);
  if (parsed.hash !== attested.hash || parsed.nonce !== attested.nonce || parsed.body !== attested.body ||
    parsed.finalityExecuted !== attested.finalityExecuted || parsed.expirationBlock !== attested.expirationBlock ||
    parsed.feeExecutedAtomic !== attested.feeExecutedAtomic || parsed.receivedAtomic !== attested.receivedAtomic) circleFail("attestation_integrity");
}
export function encodeCircleMint(attested: CircleAttestation): Hex { return encodeFunctionData({ abi: CIRCLE_ABI,
  functionName: "receiveMessage", args: [attested.bytes, attested.attestation] }); }
export function decodeCircleDestination(source: CircleSourceProof, attested: CircleAttestation, input: CircleObservation, usedNonceAtomic: string, destinationProfile?: string) {
  assertCircleAttestation(source, attested); const route = circleRoute(source.destinationChain, destinationProfile);
  const receipt = verifyCircleObservation(input, { chain: route.chainId, from: route.gasPayer, to: CIRCLE_TRANSMITTER,
    data: encodeCircleMint(attested), maxNativeDebitAtomic: BigInt(route.destinationNativeCap), maxGasAtomic: 600_000n });
  const received = oneEvent(input, "MessageReceived", CIRCLE_TRANSMITTER).args,
    mint = oneEvent(input, "MintAndWithdraw", CIRCLE_MESSENGER).args, transfer = oneEvent(input, "Transfer", route.token).args;
  if (circleUint(usedNonceAtomic) !== 1n || !addressEquals(received.caller, route.gasPayer) || received.sourceDomain !== 3 ||
    circleHex(received.nonce, 32) !== attested.nonce || circleHex(received.sender, 32) !== circleWord(CIRCLE_MESSENGER) ||
    received.finalityThresholdExecuted !== attested.finalityExecuted || circleHex(received.messageBody) !== attested.body ||
    !addressEquals(mint.mintRecipient, CIRCLE_RECIPIENT) || mint.amount !== BigInt(attested.receivedAtomic) || !addressEquals(mint.mintToken, route.token) ||
    !addressEquals(transfer.from, getAddress(`0x${"0".repeat(40)}`)) || !addressEquals(transfer.to, CIRCLE_RECIPIENT) || transfer.value !== BigInt(attested.receivedAtomic) ||
    BigInt(attested.expirationBlock) !== 0n && BigInt(attested.expirationBlock) <= BigInt(receipt.blockNumberAtomic)) circleFail("destination_mint_binding");
  return { kind: "circle_v2_evm_destination" as const, ...receipt, sourceTransactionHash: source.transactionHash,
    attestedMessageHash: attested.hash, nonce: attested.nonce, nonceConsumed: true as const, recipient: CIRCLE_RECIPIENT,
    token: route.token, amountAtomic: attested.receivedAtomic };
}
export function verifyCircleApproval(input: CircleObservation, reset: boolean, allowanceAtReceiptAtomic: string): CircleReceiptProof {
  const proof = verifyCircleObservation(input, { chain: 42161, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_SOURCE_TOKEN,
    data: encodeCircleApproval(reset), maxNativeDebitAtomic: 30_000_000_000_000n, maxGasAtomic: 100_000n });
  const args = oneEvent(input, "Approval", CIRCLE_SOURCE_TOKEN).args, amount = reset ? 0n : CIRCLE_AMOUNT;
  if (!addressEquals(args.owner, CIRCLE_SOURCE_OWNER) || !addressEquals(args.spender, CIRCLE_MESSENGER) ||
    args.value !== amount || circleUint(allowanceAtReceiptAtomic) !== amount) circleFail("approval_binding"); return proof;
}
