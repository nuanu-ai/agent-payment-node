import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { BASE_USDC, CHAIN_ID, MAX_NONCE_SCAN_BLOCKS, MAX_RPC_RESPONSE_BYTES } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import type { Address, Hex } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcLog, RpcPort, RpcReceipt } from "./ports.js";

type JsonRpcResult = { readonly jsonrpc: "2.0"; readonly id: string; readonly result: unknown };
interface PinnedAddress { readonly address: string; readonly family: 4 | 6 }

export class HttpsBaseRpc implements RpcPort {
  readonly endpoint: URL;
  readonly rpcOrigin: string;
  private sequence = 0n;
  private pinnedAddresses: Promise<readonly PinnedAddress[]> | undefined;

  constructor(endpoint: string) {
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new ApnError("APN_RPC_CONFIG", "RPC endpoint must be an explicit public HTTPS URL."); }
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      throw new ApnError("APN_RPC_CONFIG", "RPC endpoint must be credential-free HTTPS.");
    }
    if (parsed.hash !== "") throw new ApnError("APN_RPC_CONFIG", "RPC endpoint must not contain a fragment.");
    const host = unbracket(parsed.hostname);
    if (host.length === 0) throw new ApnError("APN_RPC_CONFIG", "RPC endpoint host is missing.");
    if (isIP(host) !== 0 && !isPublicIp(host)) throw new ApnError("APN_RPC_CONFIG", "RPC endpoint must use a public network target.");
    this.endpoint = parsed;
    this.rpcOrigin = parsed.origin;
  }

  async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    const chainId = rpcQuantity(await this.call("eth_chainId", []));
    if (chainId !== BigInt(CHAIN_ID)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC endpoint is not Base chain ID 8453.");
    return { chainId: CHAIN_ID, rpcOrigin: this.rpcOrigin };
  }

  async getBalances(address: Address): Promise<BalanceSnapshot> {
    await this.assertBaseChain();
    const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const blockNumber = rpcQuantity(block.number).toString();
    const blockHash = rpcHex(block.hash, 32);
    const tag = block.number;
    const eth = rpcQuantity(await this.call("eth_getBalance", [address, tag])).toString();
    const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
    const usdc = rpcQuantity(await this.call("eth_call", [{ to: BASE_USDC, data }, tag])).toString();
    return { address, ethAtomic: eth, usdcAtomic: usdc, blockNumberAtomic: blockNumber, blockHash, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
  }

  async getPendingNonce(address: Address): Promise<string> {
    await this.assertBaseChain();
    return rpcQuantity(await this.call("eth_getTransactionCount", [address, "pending"])).toString();
  }

  async estimateDirectTransfer(input: { readonly from: Address; readonly to: Address; readonly data: Hex }): Promise<FeeEstimate> {
    await this.assertBaseChain();
    if (input.to !== BASE_USDC) throw new ApnError("APN_INVALID_INPUT", "Only exact Base USDC is supported.");
    const gas = rpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: "0x0" }]));
    const priority = rpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const baseFee = rpcQuantity(block.baseFeePerGas);
    return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: (baseFee * 2n + priority).toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }

  async submitRawTransaction(rawTransaction: Hex): Promise<Hex> {
    try { return rpcHex(await this.call("eth_sendRawTransaction", [rawTransaction]), 32); }
    catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Transaction submission outcome is ambiguous."); }
  }

  async getReceipt(transactionHash: Hex): Promise<RpcReceipt | null> {
    await this.assertBaseChain();
    const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null) return null;
    const receipt = record(raw, "transaction receipt");
    const status = rpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt status is invalid.");
    if (!Array.isArray(receipt.logs)) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt logs are invalid.");
    const logs: RpcLog[] = receipt.logs.map((entry: unknown) => {
      const log = record(entry, "receipt log");
      if (!Array.isArray(log.topics)) throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics are invalid.");
      return { address: rpcAddress(log.address), topics: log.topics.map((topic: unknown) => rpcHex(topic, 32)), data: rpcHex(log.data) };
    });
    return { transactionHash: rpcHex(receipt.transactionHash, 32), status: status === 1n ? "success" : "reverted", blockNumberAtomic: rpcQuantity(receipt.blockNumber).toString(), logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
  }

  async getLatestConfirmedNonce(address: Address): Promise<string> {
    await this.assertBaseChain();
    return rpcQuantity(await this.call("eth_getTransactionCount", [address, "latest"])).toString();
  }

  async getConfirmedTransactionAtNonce(address: Address, nonceAtomic: string, startBlockNumberAtomic: string): Promise<Hex | null> {
    await this.assertBaseChain();
    const latestBlock = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const latest = rpcQuantity(latestBlock.number);
    const requestedStart = parseAtomic(startBlockNumberAtomic);
    const boundedStart = latest >= MAX_NONCE_SCAN_BLOCKS - 1n ? latest - (MAX_NONCE_SCAN_BLOCKS - 1n) : 0n;
    const start = requestedStart > boundedStart ? requestedStart : boundedStart;
    for (let blockNumber = latest; blockNumber >= start; blockNumber -= 1n) {
      const tag = `0x${blockNumber.toString(16)}`;
      const block = record(await this.call("eth_getBlockByNumber", [tag, true]), "confirmed block");
      if (!Array.isArray(block.transactions)) throw new ApnError("APN_RPC_PROTOCOL", "RPC block transactions are invalid.");
      for (const item of block.transactions) {
        const transaction = record(item, "block transaction");
        if (typeof transaction.from === "string" && transaction.from.toLowerCase() === address.toLowerCase() && rpcQuantity(transaction.nonce).toString() === nonceAtomic) {
          return rpcHex(transaction.hash, 32);
        }
      }
      if (blockNumber === 0n) break;
    }
    return null;
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = (++this.sequence).toString();
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
    const raw = await postJson(this.endpoint, body, addresses);
    let value: unknown;
    try { value = JSON.parse(raw) as unknown; } catch { throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not valid JSON."); }
    const message = record(value, "JSON-RPC response");
    if (message.jsonrpc !== "2.0" || message.id !== id || !("result" in message) || "error" in message) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates JSON-RPC identity or result requirements.");
    }
    return (message as JsonRpcResult).result;
  }

  private async resolvePublicAddresses(): Promise<readonly PinnedAddress[]> {
    const host = unbracket(this.endpoint.hostname);
    const literal = isIP(host);
    const rows = literal === 0 ? await lookup(host, { all: true, verbatim: true }).catch(() => {
      throw new ApnError("APN_RPC_CONFIG", "RPC host could not be resolved safely.");
    }) : [{ address: host, family: literal }];
    if (rows.length === 0 || rows.some((row) => !isPublicIp(row.address))) {
      throw new ApnError("APN_RPC_CONFIG", "RPC DNS resolution includes a non-public address.");
    }
    return rows.map((row) => ({ address: row.address, family: row.family as 4 | 6 }));
  }
}

async function postJson(endpoint: URL, body: string, addresses: readonly PinnedAddress[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) { reject(new ApnError("APN_RPC_CONFIG", "RPC host has no validated address.")); return; }
    const request = httpsRequest(endpoint, {
      method: "POST",
      family: selected.family,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC redirects are forbidden.")); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.")); return; }
      const declared = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declared) && declared > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks, total).toString("utf8")));
      response.on("error", () => reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC response failed safely.")));
    });
    request.setTimeout(20_000, () => request.destroy(new ApnError("APN_RPC_AMBIGUOUS", "RPC request timed out.")));
    request.on("error", (error) => reject(error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "RPC transport failed safely.")));
    request.end(body);
  });
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 2, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return false;
    if (normalized.startsWith("::ffff:")) return isPublicIp(normalized.slice(7));
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    if ((first & 0xe000) !== 0x2000 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
    return !normalized.startsWith("2001:db8:");
  }
  return false;
}

function unbracket(host: string): string { return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host; }
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
  return value as Record<string, unknown>;
}
function rpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC quantity is not canonical hexadecimal.");
  return BigInt(value);
}
function rpcHex(value: unknown, byteLength?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data is invalid.");
  if (byteLength !== undefined && value.length !== 2 + byteLength * 2) throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data has the wrong length.");
  return value.toLowerCase() as Hex;
}
function rpcAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC address is invalid.");
  return value as Address;
}
