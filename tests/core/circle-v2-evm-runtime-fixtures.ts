import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { CIRCLE_AMOUNT, CIRCLE_DEPLOYMENT_PINS, CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_RECIPIENT,
  CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";
import { CIRCLE_ABI, CIRCLE_ZERO, bindCircleAttestation, circleWord, decodeCircleDestination, decodeCircleMessage, decodeCircleSource,
  encodeCircleApproval, encodeCircleBurn, encodeCircleMint, verifyCircleApproval, circleAttesterConfigurationHash, verifyCircleAttestationSigners, type CircleAttesterSnapshot,
  type CircleObservation, type CircleSourceProof } from "../../src/circle-v2-evm/protocol.js";
import { quoteCircleFastFee, assertCircleFeeQuote, verifyCircleDeployments, verifyCircleGasEnvelope, verifyCircleMintPreflight,
  verifyCircleSourceAccount, verifyCircleClosureFinality, type CircleDeploymentSnapshot } from "../../src/circle-v2-evm/preflight.js";
const hash = `0x${"11".repeat(32)}` as Hex, blockHash = `0x${"22".repeat(32)}` as Hex, nonce = `0x${"33".repeat(32)}` as Hex;
const n = (v: bigint, bytes: number) => v.toString(16).padStart(bytes * 2, "0"), q = (v: bigint) => `0x${v.toString(16)}`;
export function message(chain: CircleDestinationChain, attested = false, fee = 6n, finality = 1000n, expiry = 1000n): Hex {
  return (`0x${n(1n,4)}${n(3n,4)}${n(BigInt(circleRoute(chain).domain),4)}${(attested ? nonce : CIRCLE_ZERO).slice(2)}` +
    `${circleWord(CIRCLE_MESSENGER).slice(2)}${circleWord(CIRCLE_MESSENGER).slice(2)}${CIRCLE_ZERO.slice(2)}` +
    `${n(1000n,4)}${n(attested ? finality : 0n,4)}${n(1n,4)}${circleWord(CIRCLE_SOURCE_TOKEN).slice(2)}` +
    `${circleWord(CIRCLE_RECIPIENT).slice(2)}${n(CIRCLE_AMOUNT,32)}${circleWord(CIRCLE_SOURCE_OWNER).slice(2)}${n(100n,32)}` +
    `${n(attested ? fee : 0n,32)}${n(attested ? expiry : 0n,32)}`) as Hex;
}
export function event(name: string, address: Address, args: Record<string, unknown>, index: number) {
  const abi = CIRCLE_ABI.find(x => x.type === "event" && x.name === name)!;
  return { address, topics: encodeEventTopics({ abi: [abi], eventName: name as never, args: args as never }),
    data: encodeAbiParameters(abi.inputs.filter(x => !("indexed" in x && x.indexed)), abi.inputs.filter(x => !("indexed" in x && x.indexed)).map(x => args[x.name]) as never),
    blockHash, blockNumber: "0xa", transactionHash: hash, logIndex: q(BigInt(index)), removed: false };
}
export function observation(chain: number, from: Address, to: Address, input: Hex, logs: unknown[]): CircleObservation {
  return { chainId: chain, finalityTag: chain === 42161 ? "included" : "safe",
    transaction: { hash, chainId: q(BigInt(chain)), from, to, input, value: "0x0", blockHash, blockNumber: "0xa",
      gas: "0x7a120", maxFeePerGas: chain === 143 ? "0x17bfac7c00" : "0x1312d00" },
    receipt: { transactionHash: hash, from, to, status: "0x1", blockHash, blockNumber: "0xa", gasUsed: "0x493e0",
      effectiveGasPrice: chain === 143 ? "0x17bfac7c00" : "0x1312d00", logs },
    canonicalBlock: { hash: blockHash, number: "0xa", transactions: [hash] }, recheckedBlock: { hash: blockHash, number: "0xa" },
    finalityHead: { hash: blockHash, number: "0xa" } };
}
export function source(chain: CircleDestinationChain) {
  const m = message(chain);
  return observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, encodeCircleBurn(chain), [
    event("MessageSent", CIRCLE_TRANSMITTER, { message: m }, 0),
    event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: CIRCLE_AMOUNT, depositor: CIRCLE_SOURCE_OWNER,
      mintRecipient: circleWord(CIRCLE_RECIPIENT), destinationDomain: circleRoute(chain).domain,
      destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: 100n, minFinalityThreshold: 1000, hookData: "0x" }, 1),
  ]);
}
const signers = [privateKeyToAccount(`0x${n(1n,32)}`), privateKeyToAccount(`0x${n(2n,32)}`)].sort((a,b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
export const snapshot = (chain: CircleDestinationChain): CircleAttesterSnapshot => ({ threshold: 2, enabledAttesters: signers.map(x => x.address),
  chainId: chain, transmitter: CIRCLE_TRANSMITTER, blockHash, blockNumberAtomic: "10", deploymentDigest: "a".repeat(64) });
export async function iris(proof: CircleSourceProof, bytes = message(proof.destinationChain, true)) {
  const m = decodeCircleMessage(bytes, proof.destinationChain, true), sigs = await Promise.all(signers.map(x => x.sign({ hash: keccak256(bytes) })));
  return { sourceTxHash: proof.transactionHash, messages: [{ cctpVersion: 2, status: "complete", eventNonce: String(m.nonce),
    message: bytes, attestation: `0x${sigs.map(x => x.slice(2)).join("")}`,
    decodedMessage: { sourceDomain: "3", destinationDomain: String(circleRoute(proof.destinationChain).domain), nonce: String(m.nonce),
      sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, messageBody: m.body,
      minFinalityThreshold: "1000", finalityThresholdExecuted: String(m.finalityExecuted), decodedMessageBody: {
        burnToken: circleWord(CIRCLE_SOURCE_TOKEN), mintRecipient: circleWord(CIRCLE_RECIPIENT), amount: "40100",
        messageSender: circleWord(CIRCLE_SOURCE_OWNER), maxFee: "100", feeExecuted: m.feeExecutedAtomic, expirationBlock: m.expirationBlock, hookData: "0x" } } }] };
}
