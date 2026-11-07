import { keccak256, parseTransaction, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import type { Hex } from "../../src/model.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY } from "./lifi-helpers.js";

/** A signed synthetic LI.FI transaction and its canonical tx, receipt and block, shared by the bridge RPC tests. */
export type Json = Record<string, any>;
export const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`, quantity = (n: bigint | number) => `0x${n.toString(16)}`;
export const TYPES = ["legacy", "eip2930", "eip1559", "eip4844", "eip7702"] as const;
export async function signedRpcTransaction(index = 2, nonce = 7, chainId = 1, authorizationNonce = 0) {
  const type = TYPES[index]!, account = privateKeyToAccount(LIFI_SYNTHETIC_KEY);
  const common = { chainId, to: BRIDGE_DIAMOND, nonce, gas: 400000n, value: 0n, data: "0x12345678" as Hex };
  const fees = { maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 0n };
  let transaction: TransactionSerializable;
  if (type === "legacy") transaction = { ...common, type, gasPrice: 2000000000n };
  else if (type === "eip2930") transaction = { ...common, type, gasPrice: 2000000000n, accessList: [{ address: LIFI_RECIPIENT, storageKeys: [word(5n) as Hex] }] };
  else if (type === "eip1559") transaction = { ...common, ...fees, type, accessList: [] };
  else if (type === "eip4844") transaction = { ...common, ...fees, type, maxFeePerBlobGas: 100n, blobVersionedHashes: [`0x01${"67".repeat(31)}`], accessList: [] };
  else transaction = { ...common, ...fees, type, accessList: [], authorizationList: [await account.signAuthorization({ chainId: 1, contractAddress: LIFI_RECIPIENT, nonce: authorizationNonce })] };
  const raw = await account.signTransaction(transaction), parsed = parseTransaction(raw) as Json, hash = keccak256(raw);
  const rpc: Json = { hash, chainId: quantity(chainId), type: quantity(index), nonce: quantity(nonce), from: account.address, to: common.to,
    gas: quantity(common.gas), value: "0x0", input: common.data, r: parsed.r, s: parsed.s, v: quantity(parsed.v ?? BigInt(parsed.yParity)),
    ...(index === 0 ? {} : { yParity: quantity(parsed.yParity), accessList: parsed.accessList ?? [] }),
    ...(index < 2 ? { gasPrice: "0x77359400" } : { maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x0" }),
    ...(index === 3 ? { maxFeePerBlobGas: "0x64", blobVersionedHashes: parsed.blobVersionedHashes } : {}),
    ...(index === 4 ? { authorizationList: parsed.authorizationList.map((a: Json) => ({ ...a, chainId: quantity(a.chainId), nonce: quantity(a.nonce ?? 0), yParity: quantity(a.yParity) })) } : {}) };
  return { raw, hash, rpc };
}

export async function rpcObservation(chainId = 1) {
  const s = await signedRpcTransaction(2, 7, chainId), blockHash = `0x${"ab".repeat(32)}` as Hex;
  const block: Json = { number: "0x7d0", hash: blockHash, timestamp: "0x6aa004bb", baseFeePerGas: "0x1", transactions: [s.hash] };
  const tx: Json = { ...s.rpc, blockNumber: block.number, blockHash, transactionIndex: "0x0" };
  const receipt: Json = { transactionHash: s.hash, blockNumber: block.number, blockHash, transactionIndex: "0x0", from: tx.from, to: tx.to,
    type: "0x2", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [{ address: LIFI_RECIPIENT,
      blockHash, blockNumber: block.number, transactionHash: s.hash, transactionIndex: "0x0", logIndex: "0x0", removed: false, topics: [word(2n)], data: "0x" }] };
  const methods: string[] = [];
  const call: EvmRpcCall = async (method) => {
    methods.push(method);
    if (method === "eth_chainId") return quantity(chainId);
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getTransactionByHash") return tx;
    if (method === "eth_getTransactionReceipt") return receipt;
    throw new Error(`unexpected method: ${method}`);
  };
  return { ...s, tx, receipt, block, methods, rpcAdapter: new BridgeRpc(chainId as 1 | 8453, "https://ethereum.example", call) };
}
