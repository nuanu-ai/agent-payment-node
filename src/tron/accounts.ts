import { exactKeys } from "../canonical.js";
import { ApnError } from "../errors.js";
import { TRON_USDT_HEX, tronAddress, tronArray, tronAtomic, tronHex, tronProtocolFailure, tronRecord, tronTransferData, tronWord } from "./codec.js";
import type { TronRpcPort } from "./rpc.js";

export interface TronAccountRead { readonly exists: boolean; readonly normal: boolean; readonly balance: bigint; readonly raw: Record<string, unknown> }
export async function readTronAccount(rpc: TronRpcPort, address: string, solidified = false): Promise<TronAccountRead> {
  const raw = tronRecord(await rpc.call(solidified ? "walletsolidity/getaccount" : "wallet/getaccount", { address: tronHex(address), visible: false }));
  if (Object.keys(raw).length === 0) return { exists: false, normal: true, balance: 0n, raw };
  if (typeof raw.address !== "string" || tronAddress(raw.address) !== address) tronProtocolFailure();
  return { exists: true, normal: raw.type === undefined || raw.type === "Normal" || raw.type === 0 || raw.type === 0n, balance: tronAtomic(raw.balance, true), raw };
}
export function requireTronOwner(account: TronAccountRead, sender: string): void {
  if (!account.exists) throw new ApnError("APN_OPERATION_BLOCKED", "The TRON sender must be activated before a transfer.");
  if (!account.normal) throw new ApnError("APN_WALLET_MISMATCH", "This TRON profile requires a normal account controlled by its local owner key.");
  // java-tron synthesizes this permission for legacy accounts when absent.
  if (account.raw.owner_permission === undefined) return;
  const permission = tronRecord(account.raw.owner_permission);
  const allowed = ["type", "id", "permission_name", "threshold", "parent_id", "keys"];
  if (Object.keys(permission).some((key) => !allowed.includes(key)) || permission.type !== undefined && permission.type !== "Owner" && permission.type !== 0 && permission.type !== 0n || tronAtomic(permission.id, true) !== 0n || tronAtomic(permission.parent_id, true) !== 0n || tronAtomic(permission.threshold) !== 1n) ownerMismatch();
  const keys = tronArray(permission.keys, 1); if (keys.length !== 1) ownerMismatch();
  const key = tronRecord(keys[0]);
  if (!exactKeys(key, ["address", "weight"]) || typeof key.address !== "string" || tronAddress(key.address) !== sender || tronAtomic(key.weight) !== 1n) ownerMismatch();
}
export async function requireTronUsdt(rpc: TronRpcPort): Promise<void> {
  const result = await constant(rpc, "decimals()", "", false);
  if (word(result) !== 6n) throw new ApnError("APN_ASSET_MISMATCH", "The canonical TRON USDT contract does not attest six decimals.");
}
export async function tronUsdtBalance(rpc: TronRpcPort, address: string, solidified = false): Promise<bigint> {
  return word(await constant(rpc, "balanceOf(address)", tronWord(address), solidified));
}
export async function tronEnergyEstimate(rpc: TronRpcPort, sender: string, recipient: string, amount: string): Promise<bigint> {
  const value = tronRecord(await rpc.call("wallet/triggerconstantcontract", { owner_address: tronHex(sender), contract_address: TRON_USDT_HEX,
    function_selector: "transfer(address,uint256)", parameter: tronTransferData(recipient, amount).slice(8), call_value: 0, visible: false }));
  if (tronRecord(value.result).result !== true) throw new ApnError("APN_OPERATION_BLOCKED", "The canonical USDT transfer simulation did not succeed.");
  const used = tronAtomic(value.energy_used); if (used === 0n) tronProtocolFailure(); return used;
}
async function constant(rpc: TronRpcPort, selector: string, parameter: string, solidified: boolean): Promise<Record<string, unknown>> {
  const value = tronRecord(await rpc.call(solidified ? "walletsolidity/triggerconstantcontract" : "wallet/triggerconstantcontract", {
    owner_address: TRON_USDT_HEX, contract_address: TRON_USDT_HEX, function_selector: selector, parameter, visible: false,
  }));
  if (tronRecord(value.result).result !== true) tronProtocolFailure(); return value;
}
function word(value: Record<string, unknown>): bigint {
  const result = tronArray(value.constant_result, 1);
  if (result.length !== 1 || typeof result[0] !== "string" || !/^[a-fA-F0-9]{64}$/u.test(result[0])) tronProtocolFailure();
  return tronAtomic(BigInt(`0x${result[0]}`).toString());
}
function ownerMismatch(): never { throw new ApnError("APN_WALLET_MISMATCH", "TRON permission zero no longer binds only the expected local owner key."); }
