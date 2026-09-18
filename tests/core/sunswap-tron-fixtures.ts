import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeAbiParameters, parseAbi, type Hex } from "viem";
import {
  SUNSWAP_MARKET_SCHEMA, SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, SUNSWAP_USDT, SUNSWAP_V2_CODE_HASHES, SUNSWAP_V2_ROUTER,
  SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX, sealSunSwapV2Market, type SunSwapV2Market, type SunSwapUnsignedTransaction,
} from "../../src/core.js";
import { TRON_GENESIS, tronHex } from "../../src/tron/codec.js";
import type { TronMethod, TronRpcPort } from "../../src/tron/rpc.js";

export const RESERVE_IN = 140127034374930n;
export const RESERVE_OUT = 46987592250428n;
export const RESERVE_TIMESTAMP = 1789705086n;
export const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const SWAP_TOPIC = "d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
export const DEPOSIT_TOPIC = "e1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
const RUNTIME = JSON.parse(readFileSync("tests/core/fixtures/sunswap-v2-runtime-code.json", "utf8")) as {
  contracts: Record<string, { address: string; codeHash: string; runtimecode: string }> };
const ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

export function v2Output(amountIn: bigint, reserveIn = RESERVE_IN, reserveOut = RESERVE_OUT): bigint {
  return (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n);
}
export function amountsHex(amountIn: bigint, out: bigint): string {
  return encodeAbiParameters([{ type: "uint256[]" }], [[amountIn, out]]).slice(2);
}
export function reservesHex(reserveIn: bigint, reserveOut: bigint, timestamp = RESERVE_TIMESTAMP): string {
  return encodeAbiParameters([{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], [reserveIn, reserveOut, Number(timestamp)]).slice(2);
}
export function blockId(number: bigint, fill = "1"): string { return number.toString(16).padStart(16, "0") + fill.repeat(48); }
export function word(address: string): string { return tronHex(address).slice(2).padStart(64, "0"); }

export function syntheticMarket(options: { readonly amountIn: bigint; readonly referenceBlockId: string; readonly headBlockNumber?: string }): SunSwapV2Market {
  const out = v2Output(options.amountIn), number = BigInt(`0x${options.referenceBlockId.slice(0, 16)}`).toString();
  return sealSunSwapV2Market({ schemaVersion: SUNSWAP_MARKET_SCHEMA, rpcOriginHash: "a".repeat(64),
    referenceBlock: { number, id: options.referenceBlockId, timestampMs: "1789603200000" }, headBlockNumber: options.headBlockNumber ?? number,
    maxHeadDrift: SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, router: SUNSWAP_V2_ROUTER, pair: SUNSWAP_V2_WTRX_USDT_PAIR, path: [SUNSWAP_WTRX, SUNSWAP_USDT],
    codeHashes: { ...SUNSWAP_V2_CODE_HASHES }, amountInAtomic: options.amountIn.toString(), amountOutAtomic: out.toString(),
    reserveInAtomic: RESERVE_IN.toString(), reserveOutAtomic: RESERVE_OUT.toString(), reserveTimestampSeconds: RESERVE_TIMESTAMP.toString(),
    amountsOutResultHex: amountsHex(options.amountIn, out), reservesResultHex: reservesHex(RESERVE_IN, RESERVE_OUT) });
}

/** A solidified V2 receipt with WTRX deposit, pair swap and USDT transfer logs to the owner; fee = energy_fee + net_fee. */
export function v2Receipt(transaction: SunSwapUnsignedTransaction, owner: string, input: bigint, output: bigint,
  fees: { readonly energy?: bigint; readonly net?: bigint } = { energy: 12_345n }) {
  const data = (...words: bigint[]) => words.map((value) => value.toString(16).padStart(64, "0")).join("");
  const router = word(SUNSWAP_V2_ROUTER), pair = word(SUNSWAP_V2_WTRX_USDT_PAIR), to = word(owner);
  return {
    transaction: { txID: transaction.txID, raw_data_hex: transaction.raw_data_hex, raw_data: structuredClone(transaction.raw_data),
      ret: [{ contractRet: "SUCCESS" }] },
    info: { id: transaction.txID, blockNumber: "123", fee: ((fees.energy ?? 0n) + (fees.net ?? 0n)).toString(),
      receipt: { result: "SUCCESS", energy_usage_total: "157354", ...(fees.energy === undefined ? {} : { energy_fee: fees.energy.toString() }),
        ...(fees.net === undefined ? {} : { net_fee: fees.net.toString() }) }, log: [
      { address: tronHex(SUNSWAP_WTRX).slice(2), topics: [DEPOSIT_TOPIC, router], data: data(input) },
      { address: tronHex(SUNSWAP_WTRX).slice(2), topics: [TRANSFER_TOPIC, router, pair], data: data(input) },
      { address: tronHex(SUNSWAP_USDT).slice(2), topics: [TRANSFER_TOPIC, pair, to], data: data(output) },
      { address: tronHex(SUNSWAP_V2_WTRX_USDT_PAIR).slice(2), topics: ["1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"],
        data: data(RESERVE_IN + input, RESERVE_OUT - output) },
      { address: tronHex(SUNSWAP_V2_WTRX_USDT_PAIR).slice(2), topics: [SWAP_TOPIC, router, to], data: data(input, 0n, 0n, output) },
    ] },
    solid: "124",
  };
}

export type SimulationMode = "success" | "not_activated" | "insufficient" | "revert";
/** Deterministic TRON full node: exact pinned runtime code, constant-product router math and echoed constant calls. */
export class FakeSunSwapRpc implements TronRpcPort {
  readonly originHash = "a".repeat(64);
  readonly calls: { readonly method: TronMethod; readonly body: Readonly<Record<string, unknown>> }[] = [];
  heads: bigint[] = [86344586n, 86344588n, 86344589n];
  reserves: [bigint, bigint] = [RESERVE_IN, RESERVE_OUT];
  reserveShift = 0n;
  simulation: SimulationMode = "success";
  revertReason = "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT";
  energyUsed = 157354n;
  account: Record<string, unknown> | null = null;
  runtimeOverride: string | null = null;
  echoData: string | null = null;
  genesis = TRON_GENESIS;
  maxFeeLimit = 15_000_000_000n;
  private headIndex = 0;

  async call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push({ method, body });
    if (method === "wallet/getblockbynum") return { blockID: this.genesis, block_header: { raw_data: { timestamp: 1529891469000n } } };
    if (method === "wallet/getnowblock") {
      const number = this.heads[Math.min(this.headIndex++, this.heads.length - 1)]!;
      return { blockID: blockId(number), block_header: { raw_data: { number, timestamp: 1789705959000n } }, transactions: [] };
    }
    if (method === "wallet/getchainparameters") return { chainParameter: [{ key: "getEnergyFee", value: 100n },
      { key: "getMaxFeeLimit", value: this.maxFeeLimit }, { key: "getTransactionFee", value: 1000n }] };
    if (method === "wallet/getcontractinfo") {
      const row = Object.values(RUNTIME.contracts).find((item) => tronHex(item.address) === body.value)!;
      return { smart_contract: { contract_address: body.value, code_hash: row.codeHash },
        runtimecode: this.runtimeOverride !== null && row.address === SUNSWAP_V2_ROUTER ? this.runtimeOverride : row.runtimecode };
    }
    if (method === "wallet/getaccount") return this.account ?? {};
    if (method === "wallet/triggerconstantcontract") return this.constant(body);
    throw new Error(`unexpected ${method}`);
  }

  private constant(body: Readonly<Record<string, unknown>>): unknown {
    const data = body.data as string, echo = { owner_address: body.owner_address, contract_address: body.contract_address,
      data: this.echoData ?? data, ...(body.call_value === undefined ? {} : { call_value: BigInt(body.call_value as number) }) };
    const transaction = (ret: Record<string, unknown>) => ({ ret: [ret], raw_data: { contract: [{ type: "TriggerSmartContract",
      parameter: { value: echo, type_url: "type.googleapis.com/protocol.TriggerSmartContract" } }], ref_block_bytes: "8242" } });
    const ok = (result: string, energy: bigint) => ({ result: { result: true }, energy_used: energy, constant_result: [result], transaction: transaction({}) });
    if (body.contract_address === tronHex(SUNSWAP_V2_WTRX_USDT_PAIR) && data === "0902f1ac") {
      return ok(reservesHex(this.reserves[0], this.reserves[1] + this.reserveShift), 2_000n);
    }
    const decoded = decodeFunctionData({ abi: ABI, data: `0x${data}` as Hex });
    if (decoded.functionName === "getAmountsOut") {
      const amountIn = decoded.args[0]; return ok(amountsHex(amountIn, v2Output(amountIn, this.reserves[0], this.reserves[1])), 4_076n);
    }
    const value = BigInt(body.call_value as number);
    if (this.simulation === "not_activated" || this.simulation === "insufficient") {
      const message = this.simulation === "not_activated" ? "Validate InternalTransfer error, no OwnerAccount." :
        "Validate InternalTransfer error, balance is not sufficient.";
      return { result: { code: "CONTRACT_VALIDATE_ERROR", message: Buffer.from(message).toString("hex") } };
    }
    if (this.simulation === "revert") {
      const revert = `08c379a0${encodeAbiParameters([{ type: "string" }], [this.revertReason]).slice(2)}`;
      return { result: { result: true, message: Buffer.from("REVERT opcode executed").toString("hex") }, energy_used: 30_000n,
        constant_result: [revert], transaction: transaction({ ret: "FAILED" }) };
    }
    return { ...ok(amountsHex(value, v2Output(value, this.reserves[0], this.reserves[1])), this.energyUsed), energy_penalty: 52_762n,
      logs: [], internal_transactions: [] };
  }
}
