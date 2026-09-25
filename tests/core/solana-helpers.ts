import assert from "node:assert/strict";
import type { OperationAbandonApprovalPort } from "../../src/operation-abandon-approval.js";
import { address, createKeyPairSignerFromPrivateKeyBytes, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ApnCore } from "../../src/core.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { SOLANA_GENESIS, SOLANA_USDC } from "../../src/chain-policy.js";
import { sha256 } from "../../src/canonical.js";
import type { RailApprovalPort, RailPreparedTransfer } from "../../src/direct-rail-ports.js";
import type { DirectAllowlistBinding } from "../../src/direct-allowlist-gate.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { WaitPort } from "../../src/ports.js";
import { ApnError } from "../../src/errors.js";
import { StateStore } from "../../src/state.js";
import { associatedToken } from "../../src/solana/accounts.js";
import { SolanaLocalAdapter } from "../../src/solana/local-adapter.js";
import type { SolanaBatchRead, SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";
import { SOLANA_CHAIN, activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";

export const SOL_RECIPIENT = "So11111111111111111111111111111111111111112";
export const SOL_BLOCKHASH = "11111111111111111111111111111111";
export class SolanaWrapping implements WrappingSecretPort {
  loads = 0; creates = 0; available = true;
  async load(): Promise<Buffer | null> { this.loads++; return this.available ? Buffer.alloc(32, 73) : null; }
  async create(): Promise<Buffer> { this.creates++; return Buffer.alloc(32, 73); }
}
export class SolanaApproval implements RailApprovalPort {
  calls: Parameters<RailApprovalPort["approve"]>[0][] = [];
  allowlistBindings: (DirectAllowlistBinding | undefined)[] = [];
  refuse = false;
  /** Stands in for the time the owner spends reading the screen. */
  onApprove: (() => void) | undefined;
  async approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void> {
    this.calls.push(input); this.allowlistBindings.push(input.allowlist); this.onApprove?.(); if (this.refuse) throw new Error("synthetic approval refusal");
  }
}
export class SolanaWait implements WaitPort {
  readonly waits: number[] = [];
  interrupt = false;
  nowMs(): number { return 0; }
  async wait(milliseconds: number): Promise<"elapsed" | "interrupted"> {
    this.waits.push(milliseconds); return this.interrupt ? "interrupted" : "elapsed";
  }
}
export class SolanaTestRpc implements SolanaRpcPort {
  readonly originHash = sha256("synthetic_solana_rpc");
  readonly calls: SolanaMethod[] = [];
  physicalRequests = 0;
  readonly batches: SolanaMethod[][] = [];
  readonly submissions: string[] = [];
  sender = ""; sourceAta = ""; destinationAta = "";
  genesis = SOLANA_GENESIS; finalized = true; absentHistory = false; submissionTimeout = false;
  blockHeight = 100n; fee = 5000n; rent = 2039280n; native = 5_000_000_000n; token = 9_000_000n;
  lastValidBlockHeight = 200n;
  frozenFeeUnavailable = false;
  /** Set to model a validator that hands back a different recent blockhash after preparation. */
  reboundBlockhash: string | undefined;
  /** Simulation control: transport losses to serve first, then either an error or a clean run. */
  simulateTransportLosses = 0; simulateRateLimit = false; simulateError: unknown = null; simulateUnits = 450n; simulateCalls = 0;
  destinationExists = false; corruptMint = false; corruptTokenOwner = false; simulateMalformed = false;
  private blockhashCalls = 0;
  failed = false; corruptEffect = false; corruptSignature = false;
  prepared?: RailPreparedTransfer;
  /** The token mint this synthetic chain serves; USDC unless a test selects another pinned mint. */
  mint: string = SOLANA_USDC;
  async bind(sender: string): Promise<void> {
    this.sender = sender; this.sourceAta = await associatedToken(sender, this.mint); this.destinationAta = await associatedToken(SOL_RECIPIENT, this.mint);
  }
  async useMint(mint: string): Promise<void> { this.mint = mint; await this.bind(this.sender); }
  async call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> {
    this.physicalRequests++;
    return await this.respond(method, params);
  }
  async batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]> {
    this.physicalRequests++;
    this.batches.push(reads.map(read => read.method));
    return await Promise.all(reads.map(read => this.respond(read.method, read.params)));
  }
  private async respond(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> {
    this.calls.push(method);
    switch (method) {
      case "getGenesisHash": return this.genesis;
      case "getMultipleAccounts": return { context: { slot: 300n }, value: (params[0] as string[]).map((key) => this.account(key)) };
      case "getLatestBlockhash": return { context: { slot: 300n },
        value: { blockhash: this.blockhashCalls++ > 0 ? this.reboundBlockhash ?? SOL_BLOCKHASH : SOL_BLOCKHASH, lastValidBlockHeight: this.lastValidBlockHeight } };
      case "simulateTransaction": {
        this.simulateCalls++;
        if (this.simulateRateLimit) throw new ApnError("APN_RPC_RATE_LIMITED", "synthetic provider cooldown", { retryAfterMs: 3_000 });
        if (this.simulateTransportLosses-- > 0) throw new ApnError("APN_RPC_PROTOCOL", "synthetic simulation transport loss");
        if (this.simulateMalformed) return { context: { slot: 300n }, value: { logs: [], unitsConsumed: this.simulateUnits } };
        return { context: { slot: 300n }, value: { err: this.simulateError, logs: [], unitsConsumed: this.simulateUnits, accounts: null, returnData: null } };
      }
      // A node answers null for a message whose blockhash it has already forgotten, which is what an owner
      // who read the screen for two minutes leaves behind. The fresh reference the send guard takes prices fine.
      case "getFeeForMessage":
        return { context: { slot: 300n }, value: this.frozenFeeUnavailable && this.blockhashCalls <= 1 ? null : this.fee };
      case "getBlockHeight": return this.blockHeight;
      case "getMinimumBalanceForRentExemption": return this.rent;
      case "sendTransaction": {
        const raw = params[0] as string; this.submissions.push(raw);
        if (this.submissionTimeout) throw new Error("synthetic network loss after broadcast");
        return getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(raw, "base64")));
      }
      case "getSignatureStatuses": return { context: { slot: 320n }, value: this.absentHistory ? [null] : [{ slot: 320n, confirmationStatus: this.finalized ? "finalized" : "confirmed", confirmations: this.finalized ? null : 1n, err: this.error() }] };
      case "getTransaction": return (params[1] as { encoding: string }).encoding === "base64"
        ? { slot: 320n, transaction: [this.submissions[this.submissions.length - 1], "base64"] } : this.parsedTransaction();
      case "getBlock": return { blockhash: SOL_BLOCKHASH, blockHeight: 120n };
      default: throw new Error("unexpected synthetic RPC method");
    }
  }
  private error(): unknown { return this.failed ? { InstructionError: [0n, { Custom: 1n }] } : null; }
  private account(key: string): unknown {
    if (key === this.sender) return info(SYSTEM_PROGRAM_ADDRESS, Buffer.alloc(0), this.native);
    if (key === this.mint) return info(this.corruptMint ? SYSTEM_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS, Buffer.from(getMintEncoder().encode({
      mintAuthority: null, supply: 1_000_000_000_000n, decimals: 6, isInitialized: true, freezeAuthority: null,
    })), this.rent);
    if (key === this.sourceAta || key === this.destinationAta && this.destinationExists) return info(TOKEN_PROGRAM_ADDRESS, Buffer.from(getTokenEncoder().encode({
      mint: address(this.mint), owner: address(this.corruptTokenOwner ? SOL_RECIPIENT : key === this.sourceAta ? this.sender : SOL_RECIPIENT),
      amount: key === this.sourceAta ? this.token : 0n, delegate: null, state: 1, isNative: null, delegatedAmount: 0n, closeAuthority: null,
    })), this.rent);
    return null;
  }
  private parsedTransaction(): unknown {
    const raw = this.submissions[this.submissions.length - 1]; assert.ok(raw);
    const wire = getTransactionDecoder().decode(Buffer.from(raw, "base64"));
    const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
    assert.equal(message.version, 0);
    const prepared = this.prepared; assert.ok(prepared);
    const keys = message.staticAccounts; const header = message.header;
    const accountKeys = keys.map((pubkey, index) => ({ pubkey, signer: index < header.numSignerAccounts,
      writable: index < header.numSignerAccounts ? index < header.numSignerAccounts - header.numReadonlySignerAccounts : index < keys.length - header.numReadonlyNonSignerAccounts, source: "transaction" }));
    const preBalances = keys.map((key) => key === this.sender ? this.native : key === this.sourceAta ? this.rent : key === SOL_RECIPIENT ? 100n : 0n);
    const postBalances = [...preBalances];
    const change = (key: string, delta: bigint): void => { const i = keys.indexOf(address(key)); assert.ok(i >= 0); postBalances[i] = postBalances[i]! + delta; };
    change(this.sender, -this.fee);
    const instructions: unknown[] = [];
    const amount = BigInt(prepared.amountAtomic);
    let preTokenBalances: unknown[] = []; let postTokenBalances: unknown[] = [];
    if (prepared.asset.alias === "sol") {
      instructions.push({ program: "system", programId: SYSTEM_PROGRAM_ADDRESS, parsed: { type: "transfer", info: { source: this.sender, destination: SOL_RECIPIENT, lamports: amount } } });
      if (!this.failed) { change(this.sender, -amount); change(SOL_RECIPIENT, amount + (this.corruptEffect ? 1n : 0n)); }
    } else {
      if (prepared.createsRecipientAccount) instructions.push({ program: "spl-associated-token-account", programId: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        parsed: { type: "createIdempotent", info: { source: this.sender, account: this.destinationAta, wallet: SOL_RECIPIENT, mint: this.mint, systemProgram: SYSTEM_PROGRAM_ADDRESS, tokenProgram: TOKEN_PROGRAM_ADDRESS } } });
      instructions.push({ program: "spl-token", programId: TOKEN_PROGRAM_ADDRESS, parsed: { type: "transferChecked", info: {
        source: this.sourceAta, destination: this.destinationAta, authority: this.sender, mint: this.mint,
        tokenAmount: { amount: amount.toString(), decimals: 6n, uiAmount: Number(amount) / 1e6 },
      } } });
      const balance = (key: string, owner: string, balance: bigint) => ({ accountIndex: BigInt(keys.indexOf(address(key))), owner, mint: this.mint, programId: TOKEN_PROGRAM_ADDRESS, uiTokenAmount: { amount: balance.toString(), decimals: 6n } });
      preTokenBalances = [balance(this.sourceAta, this.sender, this.token), ...(this.destinationExists ? [balance(this.destinationAta, SOL_RECIPIENT, 0n)] : [])];
      postTokenBalances = this.failed ? preTokenBalances : [balance(this.sourceAta, this.sender, this.token - amount), balance(this.destinationAta, SOL_RECIPIENT, amount + (this.corruptEffect ? 1n : 0n))];
      if (!this.failed && prepared.createsRecipientAccount) { change(this.sender, -this.rent); change(this.destinationAta, this.rent); }
    }
    return { slot: 320n, meta: { err: this.error(), fee: this.fee, preBalances, postBalances, preTokenBalances, postTokenBalances },
      transaction: { signatures: [this.corruptSignature ? "2".repeat(88) : getSignatureFromTransaction(wire)],
        message: { accountKeys, recentBlockhash: message.lifetimeToken, instructions } } };
  }
}
function info(owner: string, data: Buffer, lamports: bigint) { return { owner, data: [data.toString("base64"), "base64"], executable: false, lamports, rentEpoch: 0n, space: BigInt(data.length) }; }

export async function solanaFixture(root: string, options: { rpc?: SolanaTestRpc; wrapping?: SolanaWrapping; approval?: SolanaApproval; admit?: boolean; abandonApproval?: OperationAbandonApprovalPort; wait?: SolanaWait } = {}) {
  const now = new Date("2026-09-08T10:00:00.000Z"); let offset = 0;
  const clock = { now: () => new Date(now.getTime() + offset) };
  const advance = (milliseconds: number): void => { offset += milliseconds; };
  const wait = options.wait ?? new SolanaWait();
  const wrapping = options.wrapping ?? new SolanaWrapping(); const storage = new ChainAccountStore(root, wrapping);
  const account = await storage.ensureLocal({ profile: "solana-test", rail: "solana", create: async () => {
    const seed = Buffer.alloc(32, 47); const signer = await createKeyPairSignerFromPrivateKeyBytes(seed); return { seed, address: signer.address };
  } });
  const rpc = options.rpc ?? new SolanaTestRpc(); await rpc.bind(account.address);
  const adapter = new SolanaLocalAdapter(storage, rpc, clock.now); const approval = options.approval ?? new SolanaApproval();
  const core = new ApnCore({ state: new StateStore(root), chainAccounts: storage, directRails: [adapter], railApproval: approval,
    chainPolicyApproval: { approve: async () => {} }, clock, wait, ...(options.abandonApproval ? { operationAbandonApproval: options.abandonApproval } : {}) });
  if (options.admit !== false) {
    for (const asset of ["sol", "usdc"] as const) {
      const admitted = await core.execute({ command: "policy.admit-solana", profile: account.profile, asset, maximumPerTransfer: "2", dailyLimit: "3", maximumFee: "0.003" });
      assert.equal(admitted.ok, true, admitted.error?.message);
    }
    // The chain policy now caps only fees and rent; the owner's amount caps come from the activated allowlist policy.
    await activateDirectPolicy(root, account.profile, { accounts: { solana: account.address }, now: clock.now(), admissions: [
      directAdmission(SOLANA_CHAIN, null, { maximumPerTransferAtomic: "2000000000", dailyLimitAtomic: "3000000000" }),
      directAdmission(SOLANA_CHAIN, SOLANA_USDC, { maximumPerTransferAtomic: "2000000", dailyLimitAtomic: "3000000" })] });
  }
  const prepare = async (asset: "sol" | "usdc" = "sol", idempotencyKey = "solana-fixture-0001") => {
    const result = await core.execute({ command: "transfer.prepare-solana", profile: account.profile, asset,
      recipient: SOL_RECIPIENT, amount: asset === "sol" ? "0.000001" : "1", maximumFee: "0.003", idempotencyKey });
    assert.equal(result.ok, true, result.error?.message);
    const id = (result.operation as { operation_id: string }).operation_id;
    rpc.prepared = (await core.rails.records.findOperation(id))!.prepared;
    return id;
  };
  return { core, storage, wrapping, adapter, approval, account, rpc, now, prepare, advance, wait };
}
