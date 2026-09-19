import assert from "node:assert/strict";
import type { OperationAbandonApprovalPort } from "../../src/operation-abandon-approval.js";
import { utils } from "tronweb";
import { ApnCore } from "../../src/core.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { sha256 } from "../../src/canonical.js";
import type { RailApprovalPort, RailPreparedTransfer } from "../../src/direct-rail-ports.js";
import type { DirectAllowlistBinding } from "../../src/direct-allowlist-gate.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { TronLocalAdapter } from "../../src/tron/local-adapter.js";
import { TRON_GENESIS, TRON_TRANSFER_TOPIC, TRON_USDT_HEX, tronHex, tronWord } from "../../src/tron/codec.js";
import type { TronMethod, TronRpcPort } from "../../src/tron/rpc.js";
import type { TronTransaction } from "../../src/tron/transaction.js";
import { TRON_CHAIN, TRON_USDT, activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";

export const TRON_RECIPIENT = utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(Array(32).fill(48)));
export const tronTestBlockId = (number: bigint) => number.toString(16).padStart(16, "0") + "ab".repeat(24);
export class TronWrapping implements WrappingSecretPort {
  loads = 0; creates = 0; available = true;
  async load(): Promise<Buffer | null> { this.loads++; return this.available ? Buffer.alloc(32, 73) : null; }
  async create(): Promise<Buffer> { this.creates++; return Buffer.alloc(32, 73); }
}
export class TronApproval implements RailApprovalPort {
  calls: Parameters<RailApprovalPort["approve"]>[0][] = [];
  allowlistBindings: (DirectAllowlistBinding | undefined)[] = [];
  refuse = false;
  async approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void> { this.calls.push(input); this.allowlistBindings.push(input.allowlist); if (this.refuse) throw new Error("synthetic approval refusal"); }
}
export class TronTestRpc implements TronRpcPort {
  readonly originHash = sha256("synthetic_tron_rpc");
  readonly calls: TronMethod[] = [];
  readonly submissions: TronTransaction[] = [];
  sender = ""; genesis = TRON_GENESIS; version = "4.8.2.1";
  native = 200_000_000n; token = 9_000_000n; destinationExists = false; senderExists = true;
  bandwidthPrice = 1000n; energyPrice = 100n; systemCreate = 1_000_000n; fixedCreate = 100_000n; creationRate = 1n;
  energyEstimate = 65_000n; energyStaked = 0n; originEnergy = 0n; bandwidthResource = false;
  solidified = true; absentHistory = false; submissionTimeout = false; failed = false;
  badAmount = false; badSignature = false; badLog = false; extraLog = false; badBlock = false; feeExtra = 0n;
  badPermission = false; senderContract = false; wrongDecimals = false; simulationFailure = false;
  explicitDefaults = false; badResult: string | undefined;
  headOffsetMs = 0; referenceMismatch = false; solidReferenceMismatch = false; solidHead: bigint | undefined;
  transactionBlock = 1010n; inclusionTimeOverride: bigint | undefined; parentTimeOverride: bigint | undefined; badParentHash = false;
  signatureAlias = false;
  prepared?: RailPreparedTransfer;
  readonly initialTime: number;
  maintenance: bigint;
  constructor(readonly now: Date) { this.initialTime = now.getTime(); this.maintenance = BigInt(now.getTime() + 7_200_000); }
  async call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push(method);
    switch (method) {
      case "wallet/getblockbynum": return Number(body.num) === 0 ? { blockID: this.genesis, block_header: { raw_data: {} } } : { ...this.block(BigInt(String(body.num))), ...(this.referenceMismatch ? { blockID: tronTestBlockId(BigInt(String(body.num))).slice(0, 16) + "cd".repeat(24) } : {}) };
      case "wallet/getnowblock": return this.block(1000n + BigInt(Math.floor((this.now.getTime() - this.initialTime) / 3000)));
      case "wallet/getnodeinfo": return { configNodeInfo: { codeVersion: this.version } };
      case "wallet/getchainparameters": return { chainParameter: Object.entries({ getTransactionFee: this.bandwidthPrice, getEnergyFee: this.energyPrice, getCreateNewAccountFeeInSystemContract: this.systemCreate,
        getCreateAccountFee: this.fixedCreate, getCreateNewAccountBandwidthRate: this.creationRate, getMaxFeeLimit: 15_000_000_000n, getMaxCreateAccountTxSize: 1000n,
        getAllowCreationOfContracts: 1n, getConsensusLogicOptimization: 1n, getRemoveThePowerOfTheGr: -1n }).map(([key, value]) => ({ key, value })) };
      case "wallet/getnextmaintenancetime": return { num: this.maintenance };
      case "wallet/getaccount": case "walletsolidity/getaccount": return this.account(String(body.address));
      case "wallet/getaccountresource": return { EnergyLimit: this.energyStaked, NetLimit: 0n };
      case "wallet/triggerconstantcontract": case "walletsolidity/triggerconstantcontract": {
        if (body.function_selector === "decimals()") return { result: { result: true }, constant_result: [(this.wrongDecimals ? 18n : 6n).toString(16).padStart(64, "0")] };
        if (body.function_selector === "balanceOf(address)") {
          const sender = body.parameter === tronWord(this.sender); const changed = this.submissions.length > 0 && !this.failed && this.prepared?.asset.kind === "token";
          const amount = changed ? BigInt(this.prepared!.amountAtomic) : 0n;
          return { result: { result: true }, constant_result: [(sender ? this.token - amount : amount).toString(16).padStart(64, "0")] };
        }
        if (body.function_selector === "transfer(address,uint256)") return { result: { result: !this.simulationFailure }, energy_used: this.energyEstimate, constant_result: ["00".repeat(32)] };
        throw new Error("unexpected constant method");
      }
      case "wallet/broadcasttransaction": {
        const tx = structuredClone(body) as unknown as TronTransaction; this.submissions.push(tx);
        this.now.setTime(this.initialTime + 60_000);
        if (this.submissionTimeout) throw new Error("synthetic timeout after network acceptance");
        return { result: true, txid: tx.txID };
      }
      case "walletsolidity/gettransactionbyid": return !this.solidified || this.absentHistory ? {} : this.transaction();
      case "walletsolidity/gettransactioninfobyid": return !this.solidified || this.absentHistory ? {} : this.info();
      case "walletsolidity/getnowblock": return this.block(this.solidHead ?? (this.submissions.length > 0 ? 1020n : 960n));
      case "walletsolidity/getblockbynum": return { ...this.block(BigInt(String(body.num)), BigInt(String(body.num)) === this.transactionBlock), ...(this.solidReferenceMismatch && Number(body.num) === 960 ? { blockID: tronTestBlockId(960n).slice(0, 16) + "cd".repeat(24) } : {}) };
      default: throw new Error("unexpected synthetic TRON method");
    }
  }
  private block(number: bigint, transactions = false) {
    const timestamp = number === this.transactionBlock && this.inclusionTimeOverride !== undefined ? this.inclusionTimeOverride :
      number + 1n === this.transactionBlock && this.parentTimeOverride !== undefined ? this.parentTimeOverride : BigInt(this.initialTime + this.headOffsetMs) + (number - 1000n) * 3000n;
    return { blockID: tronTestBlockId(number), block_header: { raw_data: { number, timestamp, parentHash: this.badParentHash && transactions ? "00".repeat(32) : tronTestBlockId(number - 1n) } },
      ...(transactions ? { transactions: [this.transaction()] } : {}) };
  }
  private account(hex: string): unknown {
    const sender = hex === tronHex(this.sender);
    const received = this.submissions.length > 0 && !this.failed && this.prepared?.asset.kind === "native";
    const exists = sender ? this.senderExists : this.destinationExists || received;
    if (!exists) return {};
    const result: Record<string, unknown> = { address: hex, balance: sender ? this.native : received ? BigInt(this.prepared!.amountAtomic) : 0n };
    if (sender && this.senderContract) result.type = "Contract";
    if (sender && (this.badPermission || this.explicitDefaults)) result.owner_permission = { type: "Owner", id: 0n, parent_id: 0n, permission_name: "owner", threshold: 1n, keys: [{ address: this.badPermission ? tronHex(TRON_RECIPIENT) : hex, weight: 1n }] };
    return result;
  }
  private transaction(): unknown {
    const input = this.submissions.at(-1); assert.ok(input);
    const result = structuredClone(input) as unknown as Record<string, unknown>;
    result.ret = [{ contractRet: this.badResult ?? (this.failed ? "REVERT" : "SUCCESS"), ...(this.explicitDefaults ? { fee: 0n, ret: "SUCESS" } : {}) }];
    if (this.badSignature) result.signature = ["ab".repeat(65)];
    if (this.signatureAlias) {
      const signature = input.signature![0]!; const v = parseInt(signature.slice(-2), 16);
      result.signature = [signature.slice(0, -2) + (v < 27 ? v + 27 : v - 27).toString(16).padStart(2, "0")];
    }
    if (this.badAmount) {
      const raw = result.raw_data as { contract: { parameter: { value: Record<string, unknown> } }[] };
      raw.contract[0]!.parameter.value.amount = 9999;
    }
    return result;
  }
  private info(): unknown {
    const tx = this.submissions.at(-1); const prepared = this.prepared; assert.ok(tx); assert.ok(prepared);
    const pb = utils.transaction.txJsonToPb(tx); pb.addSignature(Buffer.from(tx.signature![0]!, "hex"));
    const bytes = BigInt(pb.serializeBinary().length + 64); const native = prepared.asset.kind === "native";
    const creates = native && !this.destinationExists; const activation = creates ? this.systemCreate : 0n;
    const net = this.bandwidthResource ? 0n : creates ? this.fixedCreate : bytes * this.bandwidthPrice;
    const netUsage = this.bandwidthResource ? bytes * (creates ? this.creationRate : 1n) : 0n;
    const energyTotal = native ? 0n : this.energyEstimate;
    const energy = native ? 0n : (energyTotal - this.energyStaked - this.originEnergy) * this.energyPrice;
    const receipt: Record<string, unknown> = {};
    if (net > 0n || this.explicitDefaults) receipt.net_fee = net;
    if (netUsage > 0n || this.explicitDefaults) receipt.net_usage = netUsage;
    if (!native) { receipt.result = this.badResult ?? (this.failed ? "REVERT" : "SUCCESS"); receipt.energy_usage_total = energyTotal;
      if (energy > 0n || this.explicitDefaults) receipt.energy_fee = energy;
      if (this.energyStaked > 0n || this.explicitDefaults) receipt.energy_usage = this.energyStaked;
      if (this.originEnergy > 0n || this.explicitDefaults) receipt.origin_energy_usage = this.originEnergy;
    } else if (this.explicitDefaults) receipt.result = "DEFAULT";
    const total = activation + net + energy + this.feeExtra;
    const log = { address: TRON_USDT_HEX.slice(2), topics: [TRON_TRANSFER_TOPIC, tronWord(this.sender), tronWord(this.badLog ? this.sender : TRON_RECIPIENT)], data: BigInt(prepared.amountAtomic).toString(16).padStart(64, "0") };
    return { id: tx.txID, blockNumber: this.badBlock ? this.transactionBlock + 1n : this.transactionBlock,
      blockTimeStamp: this.inclusionTimeOverride ?? BigInt(this.initialTime) + (this.transactionBlock - 1000n) * 3000n, receipt,
      ...(total > 0n || this.explicitDefaults ? { fee: total } : {}),
      ...(this.failed ? { result: "FAILED" } : this.explicitDefaults ? { result: "SUCESS" } : {}),
      ...(!native ? { contract_address: TRON_USDT_HEX, log: this.failed ? [] : this.extraLog ? [log, log] : [log] } : {}) };
  }
}

export async function tronFixture(root: string, options: { rpc?: TronTestRpc; wrapping?: TronWrapping; approval?: TronApproval; admit?: boolean; abandonApproval?: OperationAbandonApprovalPort } = {}) {
  const now = options.rpc?.now ?? new Date("2026-09-08T10:00:00.000Z"); const clock = { now: () => new Date(now) };
  const wrapping = options.wrapping ?? new TronWrapping(); const storage = new ChainAccountStore(root, wrapping);
  const account = await storage.ensureLocal({ profile: "tron-test", rail: "tron", create: async () => {
    const seed = Buffer.alloc(32, 47); return { seed, address: utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey([...seed])) };
  } });
  const rpc = options.rpc ?? new TronTestRpc(now); rpc.sender = account.address;
  const adapter = new TronLocalAdapter(storage, rpc, clock.now); const approval = options.approval ?? new TronApproval();
  const core = new ApnCore({ state: new StateStore(root), chainAccounts: storage, directRails: [adapter], railApproval: approval,
    chainPolicyApproval: { approve: async () => {} }, clock, ...(options.abandonApproval ? { operationAbandonApproval: options.abandonApproval } : {}) });
  if (options.admit !== false) {
    for (const asset of ["trx", "usdt"] as const) {
      const result = await core.execute({ command: "policy.admit-tron", profile: account.profile, asset, maximumPerTransfer: "2", dailyLimit: "3", maximumFee: "30" });
      assert.equal(result.ok, true, result.error?.message);
    }
    // The chain policy now caps only fees and resources; the owner's amount caps come from the activated allowlist policy.
    const caps = { maximumPerTransferAtomic: "2000000", dailyLimitAtomic: "3000000" };
    await activateDirectPolicy(root, account.profile, { accounts: { tron: account.address }, now: new Date(now),
      admissions: [directAdmission(TRON_CHAIN, null, caps), directAdmission(TRON_CHAIN, TRON_USDT, caps)] });
  }
  const prepare = async (asset: "trx" | "usdt" = "trx", idempotencyKey = "tron-fixture-0001", maximumFee = "30") => {
    const result = await core.execute({ command: "transfer.prepare-tron", profile: account.profile, asset, recipient: TRON_RECIPIENT,
      amount: asset === "trx" ? "0.000001" : "1", maximumFee, idempotencyKey });
    assert.equal(result.ok, true, result.error?.message); const id = (result.operation as { operation_id: string }).operation_id;
    rpc.prepared = (await core.rails.records.findOperation(id))!.prepared; return id;
  };
  return { core, storage, wrapping, account, rpc, adapter, approval, now, prepare };
}
