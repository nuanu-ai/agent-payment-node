/**
 * SYNTHETIC CCTP V2 Fast network for the real Circle command path: Arbitrum (domain 3) and one destination answer public
 * JSON-RPC (single and batch POSTs), and the issuer API answers fees and attestations signed by TEST attester keys.
 * Sent transactions are recovered from their raw bytes and mined at once with the exact events the contracts emit
 * (Approval; MessageSent + DepositForBurn; MessageReceived + Transfer(s) + MintAndWithdraw). No live RPC, no funds.
 * Imports only viem and the pure route table, so a test may mock modules before loading the runtime.
 */
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbi, parseTransaction,
  recoverTransactionAddress, toHex, type AbiEvent, type Address, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";

const ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns(bool)",
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)",
  "function receiveMessage(bytes message,bytes attestation) returns(bool)",
  "function localDomain() view returns(uint32)", "function version() view returns(uint32)", "function paused() view returns(bool)",
  "function remoteTokenMessengers(uint32) view returns(bytes32)", "function localMinter() view returns(address)",
  "function localMessageTransmitter() view returns(address)", "function messageBodyVersion() view returns(uint32)",
  "function localTokenMessenger() view returns(address)", "function remoteTokensToLocalTokens(bytes32) view returns(address)",
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function usedNonces(bytes32) view returns(uint256)",
  "function signatureThreshold() view returns(uint256)", "function getNumEnabledAttesters() view returns(uint256)", "function getEnabledAttester(uint256) view returns(address)",
  "event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)",
  "event MessageSent(bytes message)",
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
  "event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken,uint256 feeCollected)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
const q = (v: bigint): Hex => `0x${v.toString(16)}`;
const hex = (v: bigint, bytes: number) => v.toString(16).padStart(bytes * 2, "0");
const word = (address: string) => `0x${"0".repeat(24)}${getAddress(address).slice(2).toLowerCase()}` as Hex;
const ZERO32 = `0x${"00".repeat(32)}` as Hex, ZERO = getAddress(`0x${"0".repeat(40)}`);
export const ISSUER_FEE_RECIPIENT = getAddress(`0x${"44".repeat(20)}`);
export const ATTESTERS = [1n, 2n].map(k => privateKeyToAccount(`0x${hex(k, 32)}`)).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
const slice = (m: Hex, start: number, length: number): Hex => `0x${m.slice(2 + start * 2, 2 + (start + length) * 2)}`;
function event(name: string, address: Address, args: Record<string, unknown>) {
  const abi = ABI.find(x => x.type === "event" && x.name === name) as AbiEvent, plain = abi.inputs.filter(x => !("indexed" in x && x.indexed));
  return { address, topics: encodeEventTopics({ abi: [abi], eventName: name as never, args: args as never }), data: encodeAbiParameters(plain, plain.map(x => args[x.name!]) as never) };
}
interface Mined { readonly transaction: Record<string, unknown>; readonly receipt: Record<string, unknown>; }

/** One EVM chain: accounts, the USDC token and the CCTP contracts' observable state. */
export class SyntheticChain {
  head = 1000n; readonly mined = new Map<string, Mined>(); readonly blocks = new Map<bigint, Hex[]>();
  readonly nonces = new Map<string, bigint>(); readonly native = new Map<string, bigint>(); readonly usdc = new Map<string, bigint>();
  readonly allowances = new Map<string, bigint>(); readonly used = new Set<string>(); sends = 0; reads = 0;
  constructor(readonly chainId: number, readonly domain: number, readonly token: Address, private readonly baseFee: bigint, private readonly net: SyntheticCctp) {}
  private hash(n: bigint): Hex { return keccak256(toHex(`block:${this.chainId}:${n}`)); }
  block(tag: string) {
    const n = ["latest", "safe", "finalized", "pending"].includes(tag) ? this.head : BigInt(tag);
    return { hash: this.hash(n), number: q(n), parentHash: this.hash(n - 1n), baseFeePerGas: q(this.baseFee), timestamp: q(1_800_000_000n + n), gasLimit: q(30_000_000n), transactions: this.blocks.get(n) ?? [] };
  }
  private key(...parts: string[]) { return parts.map(p => p.toLowerCase()).join(":"); }
  call(method: string, params: readonly unknown[]): unknown {
    this.reads++;
    if (method === "eth_chainId") return q(BigInt(this.chainId));
    if (method === "eth_getBlockByNumber") return this.block(String(params[0]));
    if (method === "eth_getBalance") return q(this.native.get(String(params[0]).toLowerCase()) ?? 0n);
    if (method === "eth_getTransactionCount") return q(this.nonces.get(String(params[0]).toLowerCase()) ?? 0n);
    if (method === "eth_maxPriorityFeePerGas") return "0x0";
    if (method === "eth_getTransactionByHash") return this.mined.get(String(params[0]).toLowerCase())?.transaction ?? null;
    if (method === "eth_getTransactionReceipt") return this.mined.get(String(params[0]).toLowerCase())?.receipt ?? null;
    if (method === "eth_estimateGas") { const name = decodeFunctionData({ abi: ABI, data: (params[0] as { data: Hex }).data }).functionName; return name === "approve" ? "0xc350" : "0x30d40"; }
    if (method === "eth_call") return this.view(params[0] as { from?: string; to: Address; data: Hex });
    if (method === "eth_sendRawTransaction") { this.reads--; return this.mine(params[0] as TransactionSerialized); }
    throw new Error(`synthetic_rpc_method:${method}`);
  }
  private view(tx: { from?: string; to: Address; data: Hex }): Hex {
    const decoded = decodeFunctionData({ abi: ABI, data: tx.data }), args = (decoded.args ?? []) as readonly unknown[], result = (value: unknown) => encodeFunctionResult({ abi: ABI, functionName: decoded.functionName as never, result: value as never });
    switch (decoded.functionName) {
      case "approve": case "receiveMessage": return result(true);
      case "depositForBurn": return "0x";
      case "localDomain": return result(this.domain);
      case "remoteTokenMessengers": return result(word(CIRCLE_MESSENGER));
      case "remoteTokensToLocalTokens": return result(this.token);
      case "localMinter": return result(CIRCLE_MINTER);
      case "localMessageTransmitter": return result(CIRCLE_TRANSMITTER);
      case "localTokenMessenger": return result(CIRCLE_MESSENGER);
      case "version": case "messageBodyVersion": return result(1);
      case "decimals": return result(6);
      case "paused": return result(false);
      case "balanceOf": return result(this.usdc.get(String(args[0]).toLowerCase()) ?? 0n);
      case "allowance": return result(this.allowances.get(this.key(String(args[0]), String(args[1]))) ?? 0n);
      case "usedNonces": return result(this.used.has(String(args[0]).toLowerCase()) ? 1n : 0n);
      case "signatureThreshold": case "getNumEnabledAttesters": return result(BigInt(ATTESTERS.length));
      case "getEnabledAttester": return result(ATTESTERS[Number(args[0])]!.address);
    }
    throw new Error(`synthetic_view:${String((decoded as { functionName: unknown }).functionName)}`);
  }
  private async mine(raw: TransactionSerialized): Promise<Hex> {
    const tx = parseTransaction(raw), from = await recoverTransactionAddress({ serializedTransaction: raw }), hash = keccak256(raw), to = getAddress(tx.to!);
    // viem leaves zero-valued RLP fields (nonce 0, value 0, tip 0) undefined.
    const nonce = BigInt(tx.nonce ?? 0), tip = tx.maxPriorityFeePerGas ?? 0n;
    if (tx.chainId !== this.chainId || nonce !== (this.nonces.get(from.toLowerCase()) ?? 0n)) throw new Error("synthetic_nonce_or_chain");
    const call = decodeFunctionData({ abi: ABI, data: tx.data! }), args = call.args as readonly unknown[];
    let logs: ReturnType<typeof event>[];
    if (call.functionName === "approve" && to === this.token) {
      this.allowances.set(this.key(from, String(args[0])), args[1] as bigint); logs = [event("Approval", this.token, { owner: from, spender: args[0], value: args[1] })];
    } else if (call.functionName === "depositForBurn" && to === CIRCLE_MESSENGER) {
      const [amount, domain, recipient, , , maxFee] = args as [bigint, number, Hex, Address, Hex, bigint, number], allowance = this.allowances.get(this.key(from, CIRCLE_MESSENGER)) ?? 0n;
      if (allowance < amount) throw new Error("synthetic_allowance");
      this.allowances.set(this.key(from, CIRCLE_MESSENGER), allowance - amount); this.usdc.set(from.toLowerCase(), (this.usdc.get(from.toLowerCase()) ?? 0n) - amount);
      const message = this.net.burnMessage(domain, recipient, amount, from, maxFee); this.net.burns.set(hash, message);
      logs = [event("MessageSent", CIRCLE_TRANSMITTER, { message }), event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: this.token, amount, depositor: from, mintRecipient: recipient,
        destinationDomain: domain, destinationTokenMessenger: word(CIRCLE_MESSENGER), destinationCaller: ZERO32, maxFee, minFinalityThreshold: 1000, hookData: "0x" })];
    } else if (call.functionName === "receiveMessage" && to === CIRCLE_TRANSMITTER) {
      const m = args[0] as Hex, nonce = slice(m, 12, 32), recipient = getAddress(`0x${slice(m, 184, 32).slice(-40)}`), amount = BigInt(slice(m, 216, 32)), fee = BigInt(slice(m, 312, 32));
      if (this.used.has(nonce)) throw new Error("synthetic_nonce_used"); this.used.add(nonce); this.net.mintedTo.push({ chain: this.chainId, recipient, net: amount - fee, caller: from });
      logs = [event("MessageReceived", CIRCLE_TRANSMITTER, { caller: from, sourceDomain: 3, nonce, sender: word(CIRCLE_MESSENGER), finalityThresholdExecuted: Number(BigInt(slice(m, 144, 4))), messageBody: slice(m, 148, 228) }),
        event("Transfer", this.token, { from: ZERO, to: recipient, value: amount - fee }), ...(fee === 0n ? [] : [event("Transfer", this.token, { from: ZERO, to: ISSUER_FEE_RECIPIENT, value: fee })]),
        event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: recipient, amount: amount - fee, mintToken: this.token, feeCollected: fee })];
    } else throw new Error(`synthetic_effect:${call.functionName}`);
    const n = ++this.head, blockHash = this.hash(n), gasUsed = call.functionName === "approve" ? 46_000n : 180_000n;
    this.blocks.set(n, [hash]); this.nonces.set(from.toLowerCase(), nonce + 1n); this.sends++;
    const placed = { blockHash, blockNumber: q(n), transactionHash: hash, transactionIndex: "0x0" };
    this.mined.set(hash, {
      transaction: { hash, chainId: q(BigInt(this.chainId)), from, to, input: tx.data, value: q(tx.value ?? 0n), nonce: q(nonce), gas: q(tx.gas!), maxFeePerGas: q(tx.maxFeePerGas!),
        maxPriorityFeePerGas: q(tip), blockHash, blockNumber: q(n), transactionIndex: "0x0" },
      receipt: { ...placed, from, to, status: "0x1", gasUsed: q(gasUsed), effectiveGasPrice: q(this.baseFee), logs: logs.map((l, i) => ({ ...l, ...placed, logIndex: q(BigInt(i)), removed: false })) },
    });
    return hash;
  }
}

/** Arbitrum plus one destination behind one HTTPS port, and the issuer API (fees and attestations). */
export class SyntheticCctp {
  readonly burns = new Map<string, Hex>(); readonly mintedTo: { chain: number; recipient: Address; net: bigint; caller: Address }[] = [];
  readonly arbitrum: SyntheticChain; readonly destination: SyntheticChain; readonly urls: Readonly<Record<string, SyntheticChain>>; readonly env: Readonly<Record<string, string>>;
  issuerCalls = 0;
  constructor(readonly chain: CircleDestinationChain) {
    const route = circleRoute(chain);
    this.arbitrum = new SyntheticChain(42161, 3, CIRCLE_SOURCE_TOKEN, 10_000_000n, this);
    this.destination = new SyntheticChain(chain, route.domain, route.token, 100_000n, this);
    this.urls = { "https://arbitrum.example/": this.arbitrum, [`https://dest-${chain}.example/`]: this.destination };
    this.env = { APN_ARBITRUM_RPC_URL: "https://arbitrum.example", [route.rpcEnvironment]: `https://dest-${chain}.example` };
  }
  burnMessage(domain: number, recipient: Hex, amount: bigint, sender: Address, maxFee: bigint, nonce = ZERO32, finality = 0n, fee = 0n): Hex {
    return (`0x${hex(1n, 4)}${hex(3n, 4)}${hex(BigInt(domain), 4)}${nonce.slice(2)}${word(CIRCLE_MESSENGER).slice(2)}${word(CIRCLE_MESSENGER).slice(2)}${ZERO32.slice(2)}` +
      `${hex(1000n, 4)}${hex(finality, 4)}${hex(1n, 4)}${word(CIRCLE_SOURCE_TOKEN).slice(2)}${recipient.slice(2)}${hex(amount, 32)}${word(sender).slice(2)}${hex(maxFee, 32)}${hex(fee, 32)}${hex(0n, 32)}`) as Hex;
  }
  /** The issuer's signed message for one burn: a nonzero nonce, FAST finality and the 1 bps fee the fee API quoted. */
  private async attested(burnHash: string) {
    const source = this.burns.get(burnHash.toLowerCase()); if (source === undefined) return { messages: [] };
    const recipient = slice(source, 184, 32), amount = BigInt(slice(source, 216, 32)), sender = getAddress(`0x${slice(source, 248, 32).slice(-40)}`), maxFee = BigInt(slice(source, 280, 32));
    const fee = (amount + 9_999n) / 10_000n, nonce = keccak256(toHex(`nonce:${burnHash}`)), bytes = this.burnMessage(Number(BigInt(slice(source, 8, 4))), recipient, amount, sender, maxFee, nonce, 1000n, fee);
    const signatures = await Promise.all(ATTESTERS.map(a => a.sign({ hash: keccak256(bytes) })));
    return { messages: [{ cctpVersion: 2, status: "complete", eventNonce: nonce, message: bytes, attestation: `0x${signatures.map(s => s.slice(2)).join("")}`,
      decodedMessage: { sourceDomain: "3", destinationDomain: String(BigInt(slice(source, 8, 4))), nonce, sender: word(CIRCLE_MESSENGER), recipient: word(CIRCLE_MESSENGER), destinationCaller: ZERO32,
        messageBody: slice(bytes, 148, 228), minFinalityThreshold: "1000", finalityThresholdExecuted: "1000", decodedMessageBody: { burnToken: word(CIRCLE_SOURCE_TOKEN), mintRecipient: recipient,
          amount: amount.toString(), messageSender: word(sender), maxFee: maxFee.toString(), feeExecuted: fee.toString(), expirationBlock: "0", hookData: "0x" } } }] };
  }
  readonly https = { request: async (url: string, method: string, body: string | null): Promise<{ status: number; body: string }> => {
    if (url.startsWith("https://iris-api.circle.com/")) {
      this.issuerCalls++;
      if (method !== "GET" || body !== null) throw new Error("synthetic_issuer_method");
      if (url.startsWith("https://iris-api.circle.com/v2/burn/USDC/fees/3/")) return { status: 200, body: JSON.stringify([{ finalityThreshold: 1000, minimumFee: 1 }, { finalityThreshold: 2000, minimumFee: 0 }]) };
      const hash = /^https:\/\/iris-api\.circle\.com\/v2\/messages\/3\?transactionHash=(0x[a-f0-9]{64})$/u.exec(url)?.[1];
      if (hash === undefined) throw new Error(`synthetic_issuer_url:${url}`);
      return { status: 200, body: JSON.stringify(await this.attested(hash)) };
    }
    const chain = this.urls[url]; if (chain === undefined || method !== "POST" || body === null) throw new Error(`synthetic_rpc_url:${url}`);
    const one = async (r: { id: unknown; method: string; params: readonly unknown[] }) => ({ jsonrpc: "2.0", id: r.id, result: await chain.call(r.method, r.params) });
    const request = JSON.parse(body) as unknown;
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? await Promise.all(request.map(one)) : await one(request as never)) };
  } };
}
