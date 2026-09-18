import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage,
  getCompiledTransactionMessageDecoder, getTransactionDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { ApnError } from "../../src/errors.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { decodeTickArray, decodeWhirlpool, type RawSolanaAccount } from "../../src/swap/orca-solana/accounts.js";
import { compileOrcaSwap, orcaSwapInstructions, validateOrcaSwapMessage, type OrcaSwapPlan } from "../../src/swap/orca-solana/instructions.js";
import { quoteWhirlpoolExactInAToB } from "../../src/swap/orca-solana/math.js";
import { ORCA_PROGRAM_PINS, ORCA_SOL_USDC_POOL, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, verifyOrcaProgramPins, WHIRLPOOL_ACCOUNT_DISCRIMINATOR,
  WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
import { createOrcaKeylessRuntime } from "../../src/swap/orca-solana/runtime-factory.js";
import { temporaryState } from "./helpers.js";
import { AMOUNT_IN, FakeOrcaRpc, FIXTURE, orcaOwner, orcaPolicy, PROFILE, signatureOf, tickArrayBytes } from "./orca-solana-helpers.js";

const pins = async () => ORCA_PROGRAM_PINS;
const raw = (data: Buffer): RawSolanaAccount => ({ owner: WHIRLPOOL_PROGRAM, lamports: 1n, executable: false, space: data.length, data });
const snapshotPool = () => decodeWhirlpool(ORCA_SOL_USDC_POOL, raw(Buffer.from(FIXTURE.pool, "base64")), WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
const arraysFrom = (rows: typeof FIXTURE.tickArrays) => rows.map((row) => decodeTickArray(row.address,
  raw(tickArrayBytes(row.startTickIndex, row.liquidityNet)), WHIRLPOOL_PROGRAM, TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
function reason(error: unknown): string { return error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error); }

async function flow(root: string, options: { readonly admitted?: boolean; readonly perTransfer?: string; readonly typingMs?: number } = {}) {
  let clockMs = Date.now(); const clock = { now: () => new Date(clockMs) };
  const owner = await orcaOwner(root), rpc = new FakeOrcaRpc(owner.address, owner.wsol, owner.usdc, owner.oracle);
  const policy = orcaPolicy(owner.address, clock.now(), options.perTransfer);
  let printed = "";
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { clockMs += options.typingMs ?? 0; yield Buffer.from(`${/Type ([0-9a-f]{6}) and press Enter/u.exec(printed)?.[1] ?? ""}\n`); },
    close: async () => undefined });
  const runtime = createOrcaKeylessRuntime({ state: owner.state, clock, rpc, accounts: owner.accounts, verifyPins: pins, foreground: "tty",
    policy: async (profile) => options.admitted === false || profile !== PROFILE ? null : policy, tty: { isTerminal: () => true, openTerminal: terminal } });
  const quote = async () => await runtime.quote({ profile: PROFILE, account: owner.address, amountAtomic: AMOUNT_IN.toString(), slippageBps: 50,
    ownerSlippageCapBps: 50, computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "1000" }, clock.now()) as { quoteHash: string; price: Record<string, unknown> };
  return { runtime, rpc, owner, clock, quote, printed: () => printed, advance: (ms: number) => { clockMs += ms; } };
}

test("quote math on the captured SOL/USDC snapshot equals an independent single-step CLMM computation", () => {
  const pool = snapshotPool(), arrays = arraysFrom(FIXTURE.tickArrays), result = quoteWhirlpoolExactInAToB(pool, arrays, AMOUNT_IN);
  const afterFee = AMOUNT_IN * (1_000_000n - 400n) / 1_000_000n, q64 = 1n << 64n, L = pool.liquidity, sp = pool.sqrtPrice;
  const next = (L * sp * q64 + (L * q64 + sp * afterFee) - 1n) / (L * q64 + sp * afterFee);
  assert.equal(result.steps, 1); assert.equal(result.initializedTicksCrossed, 0);
  assert.equal(result.amountOutAtomic, (L * (sp - next) / q64).toString());
  assert.equal(result.sqrtPriceAfter, next.toString()); assert.equal(result.priceImpactBps, 0);
  assert.equal(pool.feeRate, 400); assert.equal(pool.tickSpacing, 4);
  assert.deepEqual(arrays.map((row) => row.startTickIndex), [-22528, -22880, -23232]);
});

test("a swap that would leave the passed tick arrays is refused, and crossing an initialized tick applies liquidity_net", () => {
  const pool = snapshotPool(), empty = FIXTURE.tickArrays.map((row) => ({ ...row, liquidityNet: [] as [number, string][] }));
  assert.throws(() => quoteWhirlpoolExactInAToB(pool, arraysFrom(empty), 1_000_000_000_000_000n), (error) => reason(error) === "orca_tick_boundary");
  const below = Math.floor((pool.tickCurrentIndex - FIXTURE.tickArrays[0]!.startTickIndex) / 4);
  const halfOut = FIXTURE.tickArrays.map((row, index) => ({ ...row, liquidityNet: index === 0 ? [[below, (pool.liquidity / 2n).toString()]] as [number, string][] : [] }));
  const crossing = quoteWhirlpoolExactInAToB(pool, arraysFrom(halfOut), 1_000_000_000_000n);
  assert.equal(crossing.initializedTicksCrossed, 1); assert.equal(crossing.steps, 2);
  const stale = FIXTURE.tickArrays.map((row) => ({ ...row, startTickIndex: row.startTickIndex - 352 }));
  assert.throws(() => quoteWhirlpoolExactInAToB(pool, arraysFrom(stale), AMOUNT_IN), (error) => reason(error) === "orca_tick_array_state");
});

test("the instruction list is exact and every tampering is refused by the compiled-message validator", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const owner = await orcaOwner(temporary.root), hash = "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4";
  const plan: OrcaSwapPlan = { owner: owner.address, wsolAccount: owner.wsol, usdcAccount: owner.usdc, amountInLamports: AMOUNT_IN.toString(),
    minimumOutputAtomic: "1049045", computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "1000",
    tickArrays: FIXTURE.tickArrays.map((row) => row.address), oracle: owner.oracle };
  const compiled = compileOrcaSwap(plan, { blockhash: hash, lastValidBlockHeight: "400000150" });
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(compiled.unsignedPayload, "base64")).messageBytes);
  if (message.version !== 0) throw new Error("expected a v0 message");
  assert.equal(message.instructions.length, 8); assert.equal(message.header.numSignerAccounts, 1); assert.equal(message.staticAccounts[0], owner.address);
  const bytes = (instructions: readonly Instruction[]) => new Uint8Array(compileTransaction(appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(hash), lastValidBlockHeight: 400_000_150n },
      setTransactionMessageFeePayerSigner(createNoopSigner(address(owner.address)), createTransactionMessage({ version: 0 }))))).messageBytes);
  const base = [...orcaSwapInstructions(plan)], attacker = "9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p";
  const drain = getTransferSolInstruction({ source: createNoopSigner(address(owner.address)), destination: address(attacker), amount: 1n });
  const refused = (instructions: readonly Instruction[], expected: string) => assert.throws(() => validateOrcaSwapMessage(bytes(instructions), plan, hash),
    (error) => reason(error) === expected, expected);
  refused([...base, drain], "orca_instruction_writable");
  const swap = base[6]!, data = Buffer.from(swap.data!); data.writeBigUInt64LE(1n, 16);
  refused([...base.slice(0, 6), { ...swap, data: new Uint8Array(data) }, base[7]!], "orca_instruction_mismatch");
  refused([...base.slice(0, 6), { ...swap, programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4") }, base[7]!], "orca_instruction_program");
  refused([...base, { programAddress: address(WHIRLPOOL_PROGRAM), accounts: [{ address: address(attacker), role: AccountRole.READONLY_SIGNER }] }],
    "orca_instruction_signer");
  refused(base.slice(0, 7), "orca_instruction_mismatch");
  assert.throws(() => validateOrcaSwapMessage(bytes(base), plan, "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ"), (error) => reason(error) === "orca_message_lifetime");
});

test("a simulation shortfall, an insufficient balance, and program byte drift refuse before anything is saved or signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  f.rpc.simulatedOut = 1_000n;
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_simulation_output_shortfall");
  f.rpc.simulatedOut = 1_054_000n; f.rpc.ownerLamports = 5_000_000n;
  await assert.rejects(f.quote(), (error) => error instanceof ApnError && error.code === "APN_INSUFFICIENT_ASSET" && reason(error) === "orca_insufficient_sol");
  f.rpc.ownerLamports = 48_604_857n; f.rpc.simulationError = { InstructionError: [6, { Custom: 6036 }] };
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_simulation_instruction_error");
  assert.equal(f.rpc.sends.length, 0);
  const drifted = { originHash: "0".repeat(64), call: async (method: string, params: readonly unknown[]) => {
    if (method !== "getMultipleAccounts") throw new Error(method);
    return { context: { slot: 1 }, value: (params[0] as string[]).map(() => ({ data: [Buffer.alloc(36).toString("base64"), "base64"], executable: true,
      lamports: 1, owner: "BPFLoaderUpgradeab1e11111111111111111111111", rentEpoch: 0, space: 36 })) };
  } };
  await assert.rejects(verifyOrcaProgramPins(drifted), (error) => reason(error) === "orca_program_pin_drift");
});

test("prepare requires owner admission of SOL and USDC with the exact keyless pin and respects the per-transfer cap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const refused = await flow(temporary.root, { admitted: false }), quoted = await refused.quote();
  await assert.rejects(refused.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-flow-0001" }, refused.clock.now()),
    (error) => reason(error) === "swap_owner_admission_required");
  const other = await temporaryState(); t.after(other.cleanup);
  const capped = await flow(other.root, { perTransfer: "1000" }), cappedQuote = await capped.quote();
  await assert.rejects(capped.runtime.prepare({ profile: PROFILE, quoteHash: cappedQuote.quoteHash, idempotencyKey: "orca-flow-0002" }, capped.clock.now()));
  assert.equal(capped.rpc.sends.length, 0);
});

test("one foreground approval takes a fresh blockhash, re-simulates the exact bytes, seals them, and sends exactly once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root, { typingMs: 30_000 }), quoted = await f.quote();
  assert.equal(quoted.price.expectedOutputAtomic, quoteWhirlpoolExactInAToB(snapshotPool(), arraysFrom(FIXTURE.tickArrays), AMOUNT_IN).amountOutAtomic);
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-flow-0003" }, f.clock.now());
  assert.equal(prepared.state, "awaiting_approval"); assert.equal(prepared.approvalCapAtomic, "0");
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  assert.equal(sent.state, "submitted"); assert.equal(f.rpc.sends.length, 1);
  assert.deepEqual(f.rpc.simulations.map((row) => row.replace), [true, false], "quote simulation, then the exact signed-to-be bytes");
  const signed = getTransactionDecoder().decode(Buffer.from(f.rpc.sends[0]!, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(signed.messageBytes);
  assert.equal(message.lifetimeToken, "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ", "blockhash taken after approval");
  assert.equal(Buffer.from(getTransactionDecoder().decode(Buffer.from(f.rpc.simulations[1]!.payload, "base64")).messageBytes).equals(Buffer.from(signed.messageBytes)), true);
  const account = await f.owner.accounts.account(PROFILE, "solana");
  const binding = JSON.parse(await readFile(join(f.owner.state.root, "orca-execution-bindings", sent.ownerProfileHash, `${sent.operationId}.json`), "utf8"));
  assert.equal(binding.submissionMarkerHash, sent.submissionMarker?.markerHash); assert.equal(JSON.stringify(binding).includes(f.rpc.sends[0]!), false);
  const effect = await f.owner.accounts.effect(account!, sent.operationId, binding.bindingHash);
  assert.equal(effect?.rawPayload, f.rpc.sends[0], "the signed bytes were sealed in the encrypted wallet state");
  for (const line of ["You send: 0.01 SOL (10000000 lamports)", "Minimum in: ", "the Whirlpool program fails the swap below this", "Slippage cap: 50 basis points",
    "Network fee: 5200 lamports", "Token approval cap: 0", "fresh blockhash, re-simulates these exact instructions"]) assert.ok(f.printed().includes(line), line);
  f.rpc.status = "processed";
  assert.equal((await f.runtime.execute(sent.operationId, f.clock.now())).state, "submitted");
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).state, "submitted"); assert.equal(f.rpc.sends.length, 1);
  f.rpc.status = "finalized"; f.advance(20_000);
  const finalized = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(finalized.state, "finalized"); assert.equal(finalized.receiptProof?.transactionHash, signatureOf(f.rpc.sends[0]!));
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).integrityHash, finalized.integrityHash); assert.equal(f.rpc.sends.length, 1);
});

test("a finalized failed swap becomes failed_confirmed_revert, and a pre-sign refusal after approval releases the reservation unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root), quoted = await f.quote();
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-flow-0004" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  f.rpc.status = "finalized_error"; f.advance(20_000);
  const reverted = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(reverted.state, "failed_confirmed_revert"); assert.equal(reverted.usageLease?.state, "failed_confirmed_revert"); assert.equal(f.rpc.sends.length, 1);
  const other = await temporaryState(); t.after(other.cleanup);
  const g = await flow(other.root), again = await g.quote();
  const ready = await g.runtime.prepare({ profile: PROFILE, quoteHash: again.quoteHash, idempotencyKey: "orca-flow-0005" }, g.clock.now());
  g.rpc.simulatedOut = 10n;
  await assert.rejects(g.runtime.approveAndExecute(ready.operationId, g.clock.now()), (error) => reason(error) === "orca_simulation_output_shortfall");
  const released = await g.runtime.status(ready.operationId, g.clock.now());
  assert.equal(released.state, "failed_before_effect"); assert.equal(released.submissionMarker, null); assert.equal(g.rpc.sends.length, 0);
});
