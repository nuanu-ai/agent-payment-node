import { encodeFunctionData, parseAbi } from "viem";
import type { ClockPort } from "../ports.js";
import type { Address, Hex } from "../model.js";
import type { GaslessTransport } from "../gasless/https.js";
import { rpcHex, rpcWord } from "../gasless/rpc-codec.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { recoverUsdtSponsor, usdtSponsorPackedOperation } from "./sponsor-hash.js";
import { UsdtJsonRpc } from "./rpc.js";
import type { UsdtUserOperation } from "./userop.js";

const AUTH_ABI = parseAbi([
  "function signers(address) view returns (bool)",
  "function getHash(uint8 mode,(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
]);

/** Material from a trusted canonical safe snapshot, not a caller's verification boolean. */
export interface UsdtSponsorSnapshot {
  readonly chainId: bigint; readonly blockNumber: bigint; readonly blockHash: Hex;
  readonly pins: {
    readonly token: Hex; readonly entryPoint: Hex; readonly delegate: Hex; readonly paymaster: Hex;
    readonly paymasterEntryPoint: Address;
  };
}

export function assertUsdtSponsorWindow(op: UsdtUserOperation, clock: ClockPort): string {
  const at = clock.now(), ms = at.getTime();
  if (!Number.isSafeInteger(ms) || ms < 0) usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_sponsor_clock");
  const now = BigInt(Math.floor(ms / 1000)), payload = decodeUsdtPaymasterData(op.paymasterData);
  if (payload.validAfter > now || payload.validUntil < now + 60n || payload.validUntil > now + 3600n) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_validity");
  }
  return at.toISOString();
}

/** One read-only batch; caller's existing transport owns admission/pacing. No wallet/custody access. */
export async function attestUsdtSponsor(input: {
  readonly op: UsdtUserOperation; readonly snapshot: UsdtSponsorSnapshot; readonly expectedBlockHash: Hex;
  readonly transport: GaslessTransport; readonly rpcUrl: string; readonly clock: ClockPort;
}) {
  const { snapshot, op } = input;
  if (snapshot.chainId !== 1n || snapshot.blockNumber < 1n || !/^0x[0-9a-f]{64}$/u.test(snapshot.blockHash) ||
    snapshot.blockHash !== input.expectedBlockHash || snapshot.pins?.token !== USDT_GASLESS.tokenCodeHash ||
    snapshot.pins.entryPoint !== USDT_GASLESS.entryPointCodeHash || snapshot.pins.delegate !== USDT_GASLESS.delegateCodeHash ||
    snapshot.pins.paymaster !== USDT_GASLESS.paymasterCodeHash || snapshot.pins.paymasterEntryPoint !== USDT_GASLESS.entryPoint) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_snapshot");
  }
  const recovered = await recoverUsdtSponsor(op);
  const tag = { blockHash: snapshot.blockHash, requireCanonical: true };
  const rpc = new UsdtJsonRpc(input.transport, input.rpcUrl, new Set(["eth_call"]));
  const values = await rpc.batch([
    { method: "eth_call", params: [{ to: USDT_GASLESS.paymaster, data: encodeFunctionData({ abi: AUTH_ABI,
      functionName: "signers", args: [recovered.signer] }) }, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.paymaster, data: encodeFunctionData({ abi: AUTH_ABI,
      functionName: "getHash", args: [1, usdtSponsorPackedOperation(op)] }) }, tag] },
  ]);
  if (rpcWord(values[0]) !== 1n) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_not_member");
  const parityHash = rpcHex(values[1], 32, 32);
  if (parityHash !== recovered.sponsorHash) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_hash_parity");
  const capturedAt = assertUsdtSponsorWindow(op, input.clock); // Current wallclock after all awaited reads.
  return { schemaVersion: "apn.gasless-usdt-sponsor-auth.v1" as const, ...recovered,
    chainId: "1", blockNumber: snapshot.blockNumber.toString(), blockHash: snapshot.blockHash,
    pins: { ...snapshot.pins }, membership: true as const, parityHash, capturedAt };
}
