import { encodeFunctionData } from "viem";
import { ApnError } from "./errors.js";
import { evmDecimals, evmToken, evmUint, resolveEvmAsset } from "./evm-asset.js";
import { directEvmNetwork, directEvmQuoteFeeModel, type DirectEvmChainId } from "./evm-direct-networks.js";
import type { EvmDirectReads } from "./evm-ports.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcWord } from "./evm-rpc-codec.js";

export const OP_STACK_GAS_ORACLE = "0x420000000000000000000000000000000000000F";
export const OP_STACK_GAS_ORACLE_ABI = [
  { type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * Physical POSTs of each phase of a direct EVM step. Every phase below is one `read`, so one POST; the endpoint's
 * chain id rides inside the first POST of the invocation and never costs one of its own.
 */
export const DIRECT_EVM_READ_PLAN = { balance: 1, nonceEstimate: 1, opStackFees: 1, send: 1, receipt: 1, evidence: 1, unlanded: 1, indexProof: 2 } as const;
/** The cap of a step is its planned POSTs times this: one more attempt of every planned POST, never an open-ended loop. */
export const DIRECT_EVM_BUDGET_HEADROOM = 2;
export type DirectEvmStep = "balance" | "prepare" | "approve" | "resume";

/** The hard POST cap of one direct EVM step, derived from the read plan above rather than counted by hand. */
export function directEvmStepBudget(chainId: DirectEvmChainId, step: DirectEvmStep): number {
  const plan = DIRECT_EVM_READ_PLAN;
  const funding = plan.balance + plan.nonceEstimate + (directEvmNetwork(chainId).feeModel === "op-stack" ? plan.opStackFees : 0);
  const observe = plan.receipt + plan.evidence;
  const planned = step === "balance" ? plan.balance : step === "prepare" ? funding : step === "approve" ? funding + plan.send + observe :
    // Resume observes and reads the never-lands batch; then either proves the node's index covers the prepared block (its
    // body, then the deciding batch) or re-sends the identical bytes once and observes them again, never both.
    observe + plan.unlanded + Math.max(plan.indexProof, plan.send + observe);
  return planned * DIRECT_EVM_BUDGET_HEADROOM;
}

export type EvmChainRead = (calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]) => Promise<readonly unknown[]>;

/**
 * One direct transfer step on one network. Balances, nonce and estimate are each read in one POST at the endpoint's
 * latest head; no header is re-read around them. A funding read is advisory before signing: the chain itself enforces
 * nonce and balance, and the frozen fee budget bounds what the signed transaction may cost.
 */
export function evmDirectReads(chainId: DirectEvmChainId, read: EvmChainRead, rpcOrigin: string, maximumSignedBytes: number): EvmDirectReads {
  const network = directEvmNetwork(chainId);
  const phase = (name: string): EvmChainRead => async calls => {
    try { return await read(calls); }
    catch (error) {
      if (error instanceof ApnError) throw new ApnError(error.code, error.message, { ...error.details, phase: name });
      throw error;
    }
  };
  let feeHead: ReturnType<typeof evmRpcBlockResult> | undefined;
  return {
    balance: async (address, selection) => {
      if (selection.chainId !== chainId) throw new ApnError("APN_INVALID_INPUT", "Direct reads require the selected network.");
      const token = evmToken(selection.token);
      if (selection.decimals !== undefined) evmDecimals(selection.decimals);
      const values = await phase("balance")([
        { method: "eth_getBlockByNumber", params: ["latest", false] },
        { method: "eth_getBalance", params: [address, "latest"] },
        ...(token === "native" ? [] : [
          { method: "eth_getCode", params: [token, "latest"] },
          { method: "eth_call", params: [{ to: token, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] },
          { method: "eth_call", params: [{ to: token, data: "0x313ce567" }, "latest"] },
        ]),
      ]);
      const head = evmRpcBlockResult(values[0], "latest");
      const nativeAtomic = evmRpcQuantity(values[1]).toString();
      let assetAtomic = nativeAtomic, observedDecimals: number | undefined;
      if (token !== "native") {
        if (evmRpcHex(values[2]) === "0x") throw new ApnError("APN_ASSET_MISMATCH", "The selected token address has no contract on this chain.");
        if (values[4] === "0x") throw new ApnError("APN_ASSET_MISMATCH", "The selected token contract did not report decimals.");
        assetAtomic = evmRpcWord(values[3]).toString();
        observedDecimals = evmDecimals(Number(evmRpcWord(values[4])));
      }
      return { address, asset: resolveEvmAsset(selection, observedDecimals), assetAtomic, nativeAtomic,
        blockNumberAtomic: head.number, blockHash: head.hash, rpcOrigin, observedAt: new Date().toISOString() };
    },
    nonceEstimate: async (address, transaction) => {
      if (transaction.chainId !== chainId) throw new ApnError("APN_INVALID_INPUT", "Direct reads require the selected network.");
      // Arbitrum folds the L1 cost into L2 gas and charges no separate priority fee.
      const inclusive = network.feeModel === "arbitrum-inclusive";
      const values = await phase("nonce_estimate")([
        { method: "eth_getTransactionCount", params: [address, "pending"] },
        { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
          value: `0x${evmUint(transaction.valueAtomic).toString(16)}` }] },
        ...(inclusive ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [] }]),
        { method: "eth_getBlockByNumber", params: ["latest", false] },
      ]);
      const nonce = evmRpcQuantity(values[0]).toString(), gas = evmRpcQuantity(values[1]);
      const priority = inclusive ? 0n : evmRpcQuantity(values[2]);
      const head = evmRpcBlockResult(values[inclusive ? 2 : 3], "latest");
      // A zero base fee (BNB Smart Chain) leaves the priority fee as the whole price; a zero total price is never signed.
      const maximum = 2n * evmRpcQuantity(head.raw.baseFeePerGas) + priority;
      if (maximum === 0n) throw new ApnError("APN_RPC_PROTOCOL", "The selected RPC quoted a zero gas price.");
      evmUint(maximum.toString(), true);
      feeHead = head;
      return { nonce, estimated: { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() } };
    },
    feeQuote: async (economics) => {
      const head = feeHead;
      if (head === undefined) throw new ApnError("APN_RPC_PROTOCOL", "The direct fee quote requires this step's nonce and estimate head.");
      const execution = evmUint(economics.maximumGasCostAtomic, true);
      let l1Fee = 0n, operatorFee = 0n;
      // OP-stack chains add the L1 data fee and operator fee on top of execution; the owner's budget caps the sum.
      if (network.feeModel === "op-stack") {
        const [rawL1, rawOperator] = await phase("op_stack_fees")([
          { method: "eth_call", params: [{ to: OP_STACK_GAS_ORACLE, data: encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound",
            args: [BigInt(maximumSignedBytes)] }) }, head.tag] },
          { method: "eth_call", params: [{ to: OP_STACK_GAS_ORACLE, data: encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI, functionName: "getOperatorFee",
            args: [evmUint(economics.gasLimitAtomic, true)] }) }, head.tag] },
        ]);
        l1Fee = evmRpcWord(rawL1); operatorFee = evmRpcWord(rawOperator);
      }
      const total = evmUint((execution + l1Fee + operatorFee).toString(), true);
      const feeModel = directEvmQuoteFeeModel(chainId);
      return { chainId, ...(feeModel === undefined ? {} : { feeModel }), l1DataFeeUpperWei: l1Fee.toString(), operatorFeeUpperWei: operatorFee.toString(),
        maximumExecutionFeeWei: execution.toString(), totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false,
        blockNumberAtomic: head.number, blockHash: head.hash, rpcOrigin, observedAt: new Date().toISOString() };
    },
  };
}
