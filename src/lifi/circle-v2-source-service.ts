import { createHash } from "node:crypto";
import { encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getBase58Encoder } from "@solana/kit";
import { canonicalJson } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { associatedUsdc } from "../solana/accounts.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "./https.js";
import { NonEvmSourceJournalRepository } from "./non-evm-source-journal.js";
import { submitCircleV2BaseSourceBurn } from "./circle-v2-source-execution.js";
import type { CircleV2SourcePreparation } from "./circle-v2-source-preparation.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";

const CIRCLE = "https://iris-api.circle.com";
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WRAPPER = getAddress("0x71f54F818671cD0D7ea140Da213e5C8b5C92a408");
const ZERO = `0x${"0".repeat(64)}` as Hex;
const HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable"]);
const BALANCE = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ALLOWANCE = parseAbi(["function allowance(address,address) view returns (uint256)"]);
const ORACLE = getAddress("0x420000000000000000000000000000000000000F");
const ORACLE_ABI = parseAbi(["function getL1FeeUpperBound(uint256 size) view returns (uint256)",
  "function getOperatorFee(uint256 gas) view returns (uint256)"]);
function fail(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_source_service_${reason}`); }
function q(n: bigint): Hex { return `0x${n.toString(16)}`; }
function rq(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value)) fail("rpc_quantity");
  return BigInt(value);
}
function rw(value: unknown): bigint { return BigInt(bridgeHex(value, 32, 32)); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export interface CircleV2SourceSubmitRequest {
  readonly profile: string;
  readonly expectedPayer: string;
  readonly recipientOwner: string;
  readonly recipientSetup: "existing_ata" | "create_ata";
  readonly amountAtomic: string;
  readonly maxSourceFeeAtomic: string;
  readonly maxAllowanceAtomic: string;
  readonly maxGasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
  readonly maxNativeDebitWei: string;
  readonly idempotencyKey: string;
}
export interface CircleV2SourceResult {
  readonly operationId: string;
  readonly sourceTransactionHash: Hex;
  readonly sourceState: "submitted_pending" | "unknown_finality";
  readonly submissionAttempts: 1;
  readonly bridgeCompletion: false;
  readonly circleAttestationObserved: false;
  readonly solanaDestinationFinalized: false;
}
export interface CircleV2SourceApprovalPort { approve(preparation: CircleV2SourcePreparation): Promise<void> }

/** Production adapters use one pinned HTTPS Circle origin and one explicitly configured Base RPC origin. */
export class CircleV2SourceService {
  constructor(private readonly state: StateStore, private readonly wrapping: WrappingSecretPort,
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly approval: CircleV2SourceApprovalPort,
    private readonly transport: BridgeHttps = new BridgeHttps()) {}

  async submit(request: CircleV2SourceSubmitRequest): Promise<CircleV2SourceResult> {
    const profile = canonicalProfile(request.profile), payer = bridgeAddress(request.expectedPayer);
    const amount = bridgeUint(request.amountAtomic, true);
    const feeCap = bridgeUint(request.maxSourceFeeAtomic);
    if (feeCap >= amount || amount > 10_000_000_000_000n || request.idempotencyKey.length < 8 ||
      request.idempotencyKey.length > 128) fail("intent");
    const profileHash = this.state.profileHash(profile);
    const operationId = hash(`circle-v2-base-source\0${profileHash}\0${request.idempotencyKey}`);
    const rpcUrl = this.environment.APN_BASE_RPC_URL;
    if (rpcUrl === undefined) return fail("base_rpc_missing");
    const rpc = new CircleBaseJsonRpc(rpcUrl, this.transport);
    const walletStore = new EncryptedWalletStore(this.state, this.wrapping);
    await this.state.initialize();
    // No wallet.ensure or import is called here; an operator must import the exact payer profile separately.
    const loaded = await walletStore.describe(profile);
    if (loaded === null) fail("wallet_missing");
    try {
    if (loaded.identity.address !== payer || loaded.identity.profile !== profile ||
      privateKeyToAccount(loaded.secret.privateKey).address !== payer) fail("wallet_owner");
    const ata = await associatedUsdc(request.recipientOwner);
    const bytes = getBase58Encoder().encode(ata);
    if (bytes.length !== 32) fail("recipient_ata");
    const mintRecipient = `0x${Buffer.from(bytes).toString("hex")}` as Hex;
    const ownerBytes = getBase58Encoder().encode(request.recipientOwner);
    if (ownerBytes.length !== 32) fail("recipient_owner");
    const hook = request.recipientSetup === "existing_ata" ? HOOK :
      `${HOOK.slice(0, 50)}000000000000002101${Buffer.from(ownerBytes).toString("hex")}`;
    const quoteRequest = { amount: amount.toString(), feeToken: USDC,
      requests: [{ type: "FORWARD", params: { hookData: hook } }] };
    const circlePost = async (path: string, body: unknown): Promise<unknown> => {
      const response = await this.transport.request(`${CIRCLE}${path}`, "POST", canonicalJson(body), 1024 * 1024, "APN_HTTP_CONFIG");
      if (response.status !== 200) fail("circle_http_status");
      try { return JSON.parse(response.body) as unknown; } catch { return fail("circle_json"); }
    };
      const result = await submitCircleV2BaseSourceBurn({ payer, solanaWalletOwner: request.recipientOwner,
        solanaRecipientAta: ata, recipientSetup: request.recipientSetup, profileHash, operationId,
        limits: { maxAllowanceAtomic: request.maxAllowanceAtomic, maxGasLimitAtomic: request.maxGasLimitAtomic,
          maxFeePerGasWei: request.maxFeePerGasWei, maxPriorityFeePerGasWei: request.maxPriorityFeePerGasWei,
          maxNativeDebitWei: request.maxNativeDebitWei, ttlMs: 60_000 },
        claimedValidationHash: hash(canonicalJson({ quoteRequest, operationId })), minFinalityThreshold: 1000 }, {
        freshDraft: async () => {
          const response = bridgeRecord(await circlePost("/v2/quote/burn/usdc/6/5", quoteRequest));
          const signedQuote = bridgeHex(response.signedQuote, 16 * 1024);
          const data = encodeFunctionData({ abi: ABI, functionName: "depositForBurnWithHookAndFees",
            args: [amount, 5, mintRecipient, USDC, ZERO, hook as Hex,
              { signedQuote, refundAddress: payer }] });
          return { payer, quoteEndpoint: `${CIRCLE}/v2/quote/burn/usdc/6/5`, quoteRequest, quoteResponse: response,
            transaction: { from: payer, to: WRAPPER, chainId: 8453, valueAtomic: "0", refundAddress: payer, data },
            recipientWallet: request.recipientOwner, recipientSetup: request.recipientSetup,
            amountAtomic: amount.toString(), maxSourceFeeAtomic: feeCap.toString() };
        },
        preflight: async query => query.target === "circle"
          ? circlePost("/v2/quote/validate/usdc/6", query.body) : rpc.call(query.method, query.params),
        readBase: async query => rpc.readSource(query),
        signer: { kind: "imported_evm_signer", address: payer,
          signTransaction: tx => privateKeyToAccount(loaded.secret.privateKey).signTransaction(tx) },
        sendRawTransaction: raw => rpc.send(raw),
        approve: p => this.approval.approve(p),
        journal: new NonEvmSourceJournalRepository(this.state.root),
      });
      return { operationId, sourceTransactionHash: result.sourceTransactionHash, sourceState: result.sourceState,
        submissionAttempts: 1, bridgeCompletion: false, circleAttestationObserved: false,
        solanaDestinationFinalized: false };
    } finally { walletStore.clear(loaded.secret); }
  }
}

/** Minimal EIP-1898 Base reader. Every token and native balance read uses the same canonical block hash. */
export class CircleBaseJsonRpc {
  readonly origin: string;
  private readonly endpoint: string;
  private sequence = 0;
  constructor(url: string, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps()) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Base RPC endpoint", 2048);
    if (parsed.search !== "" || parsed.hash !== "") fail("rpc_url");
    this.endpoint = parsed.toString(); this.origin = parsed.origin;
  }
  async call(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_call",
      "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction"].includes(method)) fail("rpc_method");
    const id = String(++this.sequence);
    const response = await this.https.request(this.endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }),
      1024 * 1024, "APN_RPC_CONFIG");
    if (response.status !== 200) fail("rpc_status");
    let result: Record<string, unknown>;
    try { result = bridgeRecord(JSON.parse(response.body)); } catch { return fail("rpc_json"); }
    if (result.jsonrpc !== "2.0" || String(result.id) !== id || !Object.hasOwn(result, "result") ||
      Object.hasOwn(result, "error")) fail("rpc_result");
    return result.result;
  }
  async readSource(query: Readonly<{ payer: string; token: string; spender: string; to: string; data: string;
    valueAtomic: string; draftBlockNumber: string; freshBlockNumber: string; freshBlockHash: string }>) {
    if (rq(await this.call("eth_chainId", [])) !== 8453n) fail("chain_id");
    const tag = { blockHash: query.freshBlockHash, requireCanonical: true };
    const token = bridgeAddress(query.token), payer = bridgeAddress(query.payer), spender = bridgeAddress(query.spender);
    const draftBlock = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.draftBlockNumber)), false]));
    const block = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.freshBlockNumber)), false]));
    if (bridgeHex(block.hash, 32, 32) !== query.freshBlockHash) fail("block_hash");
    const call = (to: string, data: Hex) => this.call("eth_call", [{ to, data }, tag]);
    const balanceData = encodeFunctionData({ abi: BALANCE, functionName: "balanceOf", args: [payer] });
    const allowanceData = encodeFunctionData({ abi: ALLOWANCE, functionName: "allowance", args: [payer, spender] });
    const [balance, allowance, native, latest, pending, estimated, priority] = await Promise.all([
      call(token, balanceData), call(token, allowanceData), this.call("eth_getBalance", [payer, tag]),
      this.call("eth_getTransactionCount", [payer, "latest"]), this.call("eth_getTransactionCount", [payer, "pending"]),
      this.call("eth_estimateGas", [{ from: payer, to: query.to, data: query.data, value: "0x0" }, tag]),
      this.call("eth_maxPriorityFeePerGas", []),
    ]);
    const gas = rq(estimated) * 12n / 10n + 1n;
    const tip = rq(priority), baseFee = rq(block.baseFeePerGas), maxFee = 2n * baseFee + tip;
    const [l1, operator] = await Promise.all([
      call(ORACLE, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getL1FeeUpperBound",
        args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] })),
      call(ORACLE, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getOperatorFee", args: [gas] })),
    ]);
    const after = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.freshBlockNumber)), false]));
    if (bridgeHex(after.hash, 32, 32) !== query.freshBlockHash || rq(await this.call("eth_chainId", [])) !== 8453n) fail("block_drift");
    return { chainId: 8453 as const, payer, draftBlockHash: bridgeHex(draftBlock.hash, 32, 32),
      blockNumber: query.freshBlockNumber, blockHash: query.freshBlockHash,
      latestNonceAtomic: rq(latest).toString(), pendingNonceAtomic: rq(pending).toString(),
      usdcBalanceAtomic: rw(balance).toString(), usdcAllowanceAtomic: rw(allowance).toString(),
      nativeBalanceWei: rq(native).toString(), gasLimitAtomic: gas.toString(),
      maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: tip.toString(),
      l1DataFeeUpperWei: rw(l1).toString(), operatorFeeUpperWei: rw(operator).toString() };
  }
  async send(raw: Hex): Promise<Hex> {
    const returned = bridgeHex(await this.call("eth_sendRawTransaction", [raw]), 32, 32);
    if (returned !== keccak256(raw)) fail("send_hash");
    return returned as Hex;
  }
}
