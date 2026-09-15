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
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { SolanaLocalAdapter } from "../../src/solana/local-adapter.js";
import type { SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";

export const SOL_RECIPIENT = "So11111111111111111111111111111111111111112";
export const SOL_BLOCKHASH = "11111111111111111111111111111111";
export class SolanaWrapping implements WrappingSecretPort {
  loads = 0; creates = 0; available = true;
  async load(): Promise<Buffer | null> { this.loads++; return this.available ? Buffer.alloc(32, 73) : null; }
  async create(): Promise<Buffer> { this.creates++; return Buffer.alloc(32, 73); }
}
export class SolanaApproval implements RailApprovalPort {
  calls: Parameters<RailApprovalPort["approve"]>[0][] = [];
  refuse = false;
  async approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void> {
    this.calls.push(input); if (this.refuse) throw new Error("synthetic approval refusal");
  }
}
export class SolanaTestRpc implements SolanaRpcPort {
  readonly originHash = sha256("synthetic_solana_rpc");
  readonly calls: SolanaMethod[] = [];
  readonly submissions: string[] = [];
  sender = ""; sourceAta = ""; destinationAta = "";
  genesis = SOLANA_GENESIS; finalized = true; absentHistory = false; submissionTimeout = false;
  blockHeight = 100n; fee = 5000n; rent = 2039280n; native = 5_000_000_000n; token = 9_000_000n;
  destinationExists = false; corruptMint = false; corruptTokenOwner = false;
  failed = false; corruptEffect = false; corruptSignature = false;
  prepared?: RailPreparedTransfer;
  async bind(sender: string): Promise<void> { this.sender = sender; this.sourceAta = await associatedUsdc(sender); this.destinationAta = await associatedUsdc(SOL_RECIPIENT); }
  async call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> {
    this.calls.push(method);
    switch (method) {
      case "getGenesisHash": return this.genesis;
      case "getMultipleAccounts": return { context: { slot: 300n }, value: (params[0] as string[]).map((key) => this.account(key)) };
      case "getLatestBlockhash": return { context: { slot: 300n }, value: { blockhash: SOL_BLOCKHASH, lastValidBlockHeight: 200n } };
      case "getFeeForMessage": return { context: { slot: 300n }, value: this.fee };
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
    if (key === SOLANA_USDC) return info(this.corruptMint ? SYSTEM_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS, Buffer.from(getMintEncoder().encode({
      mintAuthority: null, supply: 1_000_000_000_000n, decimals: 6, isInitialized: true, freezeAuthority: null,
    })), this.rent);
    if (key === this.sourceAta || key === this.destinationAta && this.destinationExists) return info(TOKEN_PROGRAM_ADDRESS, Buffer.from(getTokenEncoder().encode({
      mint: address(SOLANA_USDC), owner: address(this.corruptTokenOwner ? SOL_RECIPIENT : key === this.sourceAta ? this.sender : SOL_RECIPIENT),
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
        parsed: { type: "createIdempotent", info: { source: this.sender, account: this.destinationAta, wallet: SOL_RECIPIENT, mint: SOLANA_USDC, systemProgram: SYSTEM_PROGRAM_ADDRESS, tokenProgram: TOKEN_PROGRAM_ADDRESS } } });
      instructions.push({ program: "spl-token", programId: TOKEN_PROGRAM_ADDRESS, parsed: { type: "transferChecked", info: {
        source: this.sourceAta, destination: this.destinationAta, authority: this.sender, mint: SOLANA_USDC,
        tokenAmount: { amount: amount.toString(), decimals: 6n, uiAmount: Number(amount) / 1e6 },
      } } });
      const balance = (key: string, owner: string, balance: bigint) => ({ accountIndex: BigInt(keys.indexOf(address(key))), owner, mint: SOLANA_USDC, programId: TOKEN_PROGRAM_ADDRESS, uiTokenAmount: { amount: balance.toString(), decimals: 6n } });
      preTokenBalances = [balance(this.sourceAta, this.sender, this.token), ...(this.destinationExists ? [balance(this.destinationAta, SOL_RECIPIENT, 0n)] : [])];
      postTokenBalances = this.failed ? preTokenBalances : [balance(this.sourceAta, this.sender, this.token - amount), balance(this.destinationAta, SOL_RECIPIENT, amount + (this.corruptEffect ? 1n : 0n))];
      if (!this.failed && prepared.createsRecipientAccount) { change(this.sender, -this.rent); change(this.destinationAta, this.rent); }
    }
    return { slot: 320n, meta: { err: this.error(), fee: this.fee, preBalances, postBalances, preTokenBalances, postTokenBalances },
      transaction: { signatures: [this.corruptSignature ? "2".repeat(88) : getSignatureFromTransaction(wire)],
        message: { accountKeys, recentBlockhash: SOL_BLOCKHASH, instructions } } };
  }
}
function info(owner: string, data: Buffer, lamports: bigint) { return { owner, data: [data.toString("base64"), "base64"], executable: false, lamports, rentEpoch: 0n, space: BigInt(data.length) }; }

export async function solanaFixture(root: string, options: { rpc?: SolanaTestRpc; wrapping?: SolanaWrapping; approval?: SolanaApproval; admit?: boolean; abandonApproval?: OperationAbandonApprovalPort } = {}) {
  const now = new Date("2026-09-08T10:00:00.000Z"); const clock = { now: () => new Date(now) };
  const wrapping = options.wrapping ?? new SolanaWrapping(); const storage = new ChainAccountStore(root, wrapping);
  const account = await storage.ensureLocal({ profile: "solana-test", rail: "solana", create: async () => {
    const seed = Buffer.alloc(32, 47); const signer = await createKeyPairSignerFromPrivateKeyBytes(seed); return { seed, address: signer.address };
  } });
  const rpc = options.rpc ?? new SolanaTestRpc(); await rpc.bind(account.address);
  const adapter = new SolanaLocalAdapter(storage, rpc, clock.now); const approval = options.approval ?? new SolanaApproval();
  const core = new ApnCore({ state: new StateStore(root), chainAccounts: storage, directRails: [adapter], railApproval: approval,
    chainPolicyApproval: { approve: async () => {} }, clock, ...(options.abandonApproval ? { operationAbandonApproval: options.abandonApproval } : {}) });
  if (options.admit !== false) for (const asset of ["sol", "usdc"] as const) {
    const admitted = await core.execute({ command: "policy.admit-solana", profile: account.profile, asset, maximumPerTransfer: "2", dailyLimit: "3", maximumFee: "0.003" });
    assert.equal(admitted.ok, true, admitted.error?.message);
  }
  const prepare = async (asset: "sol" | "usdc" = "sol", idempotencyKey = "solana-fixture-0001") => {
    const result = await core.execute({ command: "transfer.prepare-solana", profile: account.profile, asset,
      recipient: SOL_RECIPIENT, amount: asset === "sol" ? "0.000001" : "1", maximumFee: "0.003", idempotencyKey });
    assert.equal(result.ok, true, result.error?.message);
    const id = (result.operation as { operation_id: string }).operation_id;
    rpc.prepared = (await core.rails.records.findOperation(id))!.prepared;
    return id;
  };
  return { core, storage, wrapping, adapter, approval, account, rpc, now, prepare };
}
