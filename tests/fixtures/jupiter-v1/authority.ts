// Serves the accounts of a captured material to the real resolver. Read-only: no simulation, signature or send.
import type { SolanaRpcPort } from "../../../src/solana/rpc.js";
import type { JupiterV1ResolvedMaterial } from "../../../src/swap/jupiter-solana/v1-material.js";
import { JupiterV1MaterialResolver } from "../../../src/swap/jupiter-solana/v1-resolver.js";

export interface CapturedPort { readonly rpc: SolanaRpcPort; readonly methods: string[]; readonly responseBytes: () => number }
/**
 * `edit` may rewrite one account's served bytes (an upgrade, another authority). Every call is one POST: this port has no
 * JSON-RPC batch, like the public mainnet endpoint for account reads.
 */
export function capturedPort(m: JupiterV1ResolvedMaterial, edit?: (address: string, data: Buffer) => { owner?: string } | void): CapturedPort {
 const methods: string[] = []; let bytes = 0;
 const wire = (key: string, slice?: { offset: number; length: number }) => {
  const a = m.semanticAccounts.find(a => a.address === key); if (a === undefined || a.existence === "absent") return null;
  const data = Buffer.from(a.dataBase64, "base64"), patch = edit?.(key, data) ?? {};
  return { owner: patch.owner ?? a.owner, executable: a.executable, lamports: BigInt(a.lamports), space: data.length, rentEpoch: 0n,
   data: [(slice === undefined ? data : data.subarray(slice.offset, slice.offset + slice.length)).toString("base64"), "base64"] };
 };
 const rpc: SolanaRpcPort = { originHash: "0".repeat(64), async call(method, params) {
  methods.push(method); const config = params[1] as { dataSlice?: { offset: number; length: number } } | undefined;
  let result: unknown;
  switch (method) {
   case "getGenesisHash": result = m.genesis; break;
   case "getMultipleAccounts": result = { context: { slot: BigInt(m.accountSlot) }, value: (params[0] as string[]).map(k => wire(k, config?.dataSlice)) }; break;
   case "getAccountInfo": result = { context: { slot: BigInt(m.accountSlot) }, value: wire(params[0] as string, config?.dataSlice) }; break;
   case "getFeeForMessage": result = { context: { slot: BigInt(m.accountSlot) }, value: 6400n }; break;
   case "getBlockHeight": result = 1n; break;
   case "getMinimumBalanceForRentExemption": result = 1488440n; break;
   default: throw Error(`No signing, send or simulation allowed: ${method}`);
  }
  bytes += JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v).length;
  return result;
 } };
 return { rpc, methods, responseBytes: () => bytes };
}

/** What the current resolver makes of a captured material's accounts: authority evidence and the pool's current route. */
export async function authorityMaterial(served: JupiterV1ResolvedMaterial, port: CapturedPort = capturedPort(served)): Promise<JupiterV1ResolvedMaterial> {
 return await new JupiterV1MaterialResolver(port.rpc).resolve(served.payer, served.quoteResponse, served.rawBuildResponse, served.maximumNativeExpenseLamports);
}
