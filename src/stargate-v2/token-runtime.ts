import { decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { StargateJsonRpc, confirmedStargateSourceReceipt } from "./native-runtime.js";
import { executeStargateV2Token, FileStargateTokenJournal, observeStargateV2Token, prepareStargateV2Token, stargateV2TokenCanonicalReceipt,
  STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN,
  type StargateTokenDestinationEvidence, type StargateTokenEnvelope, type StargateTokenExecutionPorts, type StargateTokenOperation } from "./token-execution.js";
import { TtyStargateTokenApproval } from "./token-tty.js";

function blocked(reason: string): never { throw new ApnError("APN_RPC_CONFIG", `Stargate token runtime unavailable: ${reason}.`, { reason }); }
function quantity(v: unknown) { if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC quantity."); return BigInt(v); }
function hash(v: unknown): Hex { if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC hash."); return v.toLowerCase() as Hex; }
function record(v: unknown): Record<string, unknown> { if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC object."); return v as Record<string, unknown>; }

class LocalStargateTokenSigner {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) { this.wallets = new EncryptedWalletStore(state, wrapping); }
  async identity(profileInput: string, expected?: Address) { const profile = canonicalProfile(profileInput), wallet = await this.wallets.describe(profile);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet is missing.");
    try { const derived = privateKeyToAccount(wallet.secret.privateKey).address; if (wallet.identity.profile !== profile || wallet.identity.address !== derived || (expected !== undefined && derived !== expected)) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet identity mismatch."); return { profile, address: derived }; } finally { this.wallets.clear(wallet.secret); } }
  async port(profileInput: string, owner: Address): Promise<StargateTokenExecutionPorts["signer"]> { const profile = canonicalProfile(profileInput), profileHash = this.state.profileHash(profile);
    return { kind: "imported_evm_signer", address: owner, signTransaction: async (tx: StargateTokenEnvelope) => await this.state.withLocks([`custody:${profileHash}`], async () => {
      const wallet = await this.wallets.describe(profile); if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet is missing.");
      try { const account = privateKeyToAccount(wallet.secret.privateKey); if (wallet.identity.profile !== profile || wallet.identity.address !== owner || account.address !== owner) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet identity mismatch.");
        return await account.signTransaction({ type: "eip1559", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] });
      } finally { this.wallets.clear(wallet.secret); }
    }) };
  }
}

export class StargateTokenService {
  private source?: StargateJsonRpc; private destination?: StargateJsonRpc; private readonly journal: FileStargateTokenJournal; private readonly local: LocalStargateTokenSigner;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number = Date.now) {
    this.journal = new FileStargateTokenJournal(state.root, state); this.local = new LocalStargateTokenSigner(state, wrapping);
  }
  async prepare(input: Readonly<{ profile: string; amountAtomic: string; nativeDropAtomic: string; minOutputAtomic: string; maxNativeDebitAtomic: string; idempotencyKey: string }>) {
    this.remote(); await this.state.initialize(); const identity = await this.local.identity(input.profile), ports = await this.ports(identity.profile, identity.address);
    return await prepareStargateV2Token({ ...input, owner: identity.address, recipient: identity.address }, ports, this.journal);
  }
  async execute(id: string) { const op = await this.required(id); return await executeStargateV2Token(id, await this.ports(op.profile, op.owner), this.journal); }
  async observe(id: string) { const op = await this.required(id); if (!["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted", "submission_started", "submitted", "unknown_finality"].includes(op.phase)) throw new ApnError("APN_OPERATION_BLOCKED", "Only an attempted Stargate token operation can be observed."); return await observeStargateV2Token(id, await this.ports(op.profile, op.owner), this.journal); }
  async status(id: string) { return await this.required(id); }
  async receipt(id: string) { return stargateV2TokenCanonicalReceipt(await this.required(id)); }
  private async required(id: string) { const op = await this.journal.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stargate token operation was not found."); return op; }
  private async ports(profile: string, owner: Address): Promise<StargateTokenExecutionPorts> { const signer = await this.local.port(profile, owner), { source, destination } = this.remote();
    const tokenAt = async (rpc: StargateJsonRpc, token: Address, account: Address, tag: string) => decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", data: await rpc.call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [account] }) }, tag]) as Hex });
    return { sourceCall: (m,p) => source.call(m,p), destinationCall: (m,p) => destination.call(m,p),
      destinationBalances: async recipient => { const block = record(await destination.call("eth_getBlockByNumber", ["safe", false])); return { tokenAtomic: (await tokenAt(destination, STARGATE_TOKEN_DESTINATION_TOKEN, recipient, String(block.number))).toString(), nativeAtomic: quantity(await destination.call("eth_getBalance", [recipient, block.number])).toString(), blockNumberAtomic: quantity(block.number).toString(), blockHash: hash(block.hash) }; },
      prepareEnvelope: async tx => { if (quantity(await source.call("eth_chainId", [])) !== 10n) throw new ApnError("APN_CHAIN_MISMATCH", "Optimism RPC identity changed."); const block = record(await source.call("eth_getBlockByNumber", ["latest", false]));
        const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.valueAtomic).toString(16)}` }; const [nonceRaw, balance, gas, tip] = await Promise.all([source.call("eth_getTransactionCount", [tx.from, "pending"]), source.call("eth_getBalance", [tx.from, "pending"]), source.call("eth_estimateGas", [rpcTx]), source.call("eth_maxPriorityFeePerGas", [])]);
        const nonce = tx.nonceAtomic === undefined ? quantity(nonceRaw) : BigInt(tx.nonceAtomic); if (nonce < quantity(nonceRaw)) throw new ApnError("APN_REPREPARE_REQUIRED", "Frozen Stargate nonce is stale."); const priority = quantity(tip), maxFee = 2n * quantity(block.baseFeePerGas) + priority;
        return { nonceAtomic: nonce.toString(), gasLimitAtomic: (quantity(gas) * 12n / 10n + 1n).toString(), maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString(), nativeBalanceAtomic: quantity(balance).toString() }; },
      signer, signerIdentity: async () => await this.local.identity(profile, owner), approve: async op => await new TtyStargateTokenApproval().approve(op),
      admitPolicy: async input => { const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, input.profile); if (active === null || active.accounts.evm !== input.owner) throw new ApnError("APN_ALLOWLIST_REFUSED", "Stargate token execution requires an active owner policy for this EVM account.");
        evaluateAssetPolicy(active.registry, { chain: "eip155:10", asset: { kind: "token", identifier: STARGATE_TOKEN_SOURCE_TOKEN }, rail: "bridge", amountAtomic: input.amountAtomic, dailyUsageAtomic: "0", asOfDate: new Date(this.now()).toISOString().slice(0,10), asOf: new Date(this.now()).toISOString() }); return { policyDigest: active.digest, policyRevision: active.revision }; },
      confirmPolicy: async op => { const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, op.profile); if (active === null || active.digest !== op.policy.policyDigest || active.revision !== op.policy.policyRevision || active.accounts.evm !== op.owner) throw new ApnError("APN_ALLOWLIST_REFUSED", "The active Stargate owner policy changed; prepare again."); evaluateAssetPolicy(active.registry, { chain: "eip155:10", asset: { kind: "token", identifier: STARGATE_TOKEN_SOURCE_TOKEN }, rail: "bridge", amountAtomic: op.amountAtomic, dailyUsageAtomic: "0", asOfDate: new Date(this.now()).toISOString().slice(0,10), asOf: new Date(this.now()).toISOString() }); },
      sendRawTransaction: async raw => { const returned = hash(await source.call("eth_sendRawTransaction", [raw])); if (returned !== keccak256(raw)) throw new Error("hash"); return returned; }, waitSourceReceipt: async txHash => await confirmedStargateSourceReceipt(source, txHash),
      observeDestination: async input => await observeStargateTokenDestination(destination, input, tokenAt), now: this.now };
  }
  private remote() { if (this.source !== undefined && this.destination !== undefined) return { source: this.source, destination: this.destination }; const source = this.env.APN_OPTIMISM_RPC_URL, destination = this.env.APN_POLYGON_RPC_URL; if (source === undefined || destination === undefined) blocked("APN_OPTIMISM_RPC_URL_and_APN_POLYGON_RPC_URL_required"); this.source = new StargateJsonRpc(source); this.destination = new StargateJsonRpc(destination); return { source: this.source, destination: this.destination }; }
}

export async function observeStargateTokenDestination(rpc: Pick<StargateJsonRpc, "call">, input: Parameters<StargateTokenExecutionPorts["observeDestination"]>[0], tokenAt?: (rpc: StargateJsonRpc, token: Address, account: Address, tag: string) => Promise<bigint>): Promise<StargateTokenDestinationEvidence | null> {
  const safe = record(await rpc.call("eth_getBlockByNumber", ["safe", false])), topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", args: { guid: input.guid, toAddress: input.recipient } });
  const logs = await rpc.call("eth_getLogs", [{ address: STARGATE_TOKEN_DESTINATION_POOL, fromBlock: `0x${BigInt(input.fromBlockNumberAtomic).toString(16)}`, toBlock: safe.number, topics }]); if (!Array.isArray(logs)) blocked("destination_logs");
  const readToken = tokenAt ?? (async (client, token, account, tag) => decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", data: await client.call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [account] }) }, tag]) as Hex }));
  for (const value of logs) { const log = record(value); try { const event = decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", topics: log.topics as [Hex, ...Hex[]], data: String(log.data) as Hex }); if (getAddress(String(log.address)) !== STARGATE_TOKEN_DESTINATION_POOL || event.args.srcEid !== 30111 || event.args.guid !== input.guid || getAddress(event.args.toAddress) !== input.recipient || event.args.amountReceivedLD.toString() !== input.minimumAmountAtomic) continue;
      const [tokenAfter, nativeAfter] = await Promise.all([readToken(rpc as StargateJsonRpc, STARGATE_TOKEN_DESTINATION_TOKEN, input.recipient, String(safe.number)), rpc.call("eth_getBalance", [input.recipient, safe.number]).then(quantity)]); const tokenBefore = BigInt(input.tokenBalanceBeforeAtomic), nativeBefore = BigInt(input.nativeBalanceBeforeAtomic); if (tokenAfter < tokenBefore || nativeAfter < nativeBefore) return null;
      return { emitter: STARGATE_TOKEN_DESTINATION_POOL, sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30111, destinationTransactionHash: hash(log.transactionHash), logIndexAtomic: quantity(log.logIndex).toString(), blockNumberAtomic: quantity(log.blockNumber).toString(), blockHash: hash(log.blockHash), finality: "safe", recipient: input.recipient, amountReceivedAtomic: event.args.amountReceivedLD.toString(), tokenBalanceBeforeAtomic: tokenBefore.toString(), tokenBalanceAfterAtomic: tokenAfter.toString(), tokenDeltaAtomic: (tokenAfter-tokenBefore).toString(), nativeBalanceBeforeAtomic: nativeBefore.toString(), nativeBalanceAfterAtomic: nativeAfter.toString(), nativeDeltaAtomic: (nativeAfter-nativeBefore).toString() };
    } catch { /* unrelated candidate */ } }
  return null;
}
