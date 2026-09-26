import assert from "node:assert/strict";
import test from "node:test";
import { getTokenEncoder } from "@solana-program/token";
import { createKeyPairSignerFromPrivateKeyBytes, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import { associatedTokenAddress } from "../../src/swap/orca-solana/accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";
import { prepareOrcaStableUnsigned, validateOrcaStableUnsigned, type OrcaStablePrepareInput } from "../../src/swap/orca-solana/stable-prepare.js";

const raw = (owner: string, data: Buffer, lamports = 3_000_000n) => ({ owner, data, lamports, space: data.length, executable: false });
const token = (mint: string, owner: string, amount: bigint) => raw(TOKEN_PROGRAM, Buffer.from(getTokenEncoder().encode({
  mint: mint as never, owner: owner as never, amount, delegate: { __option: "None" }, state: 1,
  isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" },
})));
async function input(exists = true): Promise<OrcaStablePrepareInput> {
  const owner = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 23))).address;
  return { owner, quote: { chain: ORCA_SOLANA_CHAIN, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B,
    direction: "USDC_to_USDT_exact_input", slot: "450687913", amountInAtomic: "1000000", expectedOutputAtomic: "999000",
    minimumOutputAtomic: "994005", tickCurrentIndex: 1, tickArrayStarts: [0, -88, -176], signed: false, broadcast: false },
  snapshot: { slot: "450687913", owner: raw(SYSTEM_PROGRAM, Buffer.alloc(0), 20_000_000n),
    usdcAta: token(USDC_MINT, owner, 2_000_000n), usdtAta: exists ? token(SOLANA_USDT, owner, 0n) : null,
    usdcAtaAddress: await associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM),
    usdtAtaAddress: await associatedTokenAddress(owner, SOLANA_USDT, TOKEN_PROGRAM),
    programPinsVerified: true, poolAndTickArraysVerified: true, oracleAbsent: true },
  lifetime: { blockhash: "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4", currentBlockHeight: "400000000", lastValidBlockHeight: "400000100" },
  computeUnitLimit: 250000, computeUnitPriceMicroLamports: "0", createUsdtAta: !exists,
  ...(exists ? {} : { usdtAtaRentLamports: "2000000", maximumAtaRentLamports: "2500000" }) };
}
const reason = (error: unknown) => error instanceof ApnError ? error.details?.reason : null;

test("offline stable preview compiles exact token swap without wrap or close", async () => {
  const value = await prepareOrcaStableUnsigned(await input());
  assert.equal(value.signable, false); assert.equal(value.executable, false);
  assert.deepEqual(value.instructionPrograms, ["ComputeBudget111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", WHIRLPOOL_PROGRAM]);
  const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(value.messageBase64, "base64"));
  assert.equal(message.header.numSignerAccounts, 1);
  assert.equal(message.staticAccounts[0], value.owner);
  assert.equal(message.version, 0);
  if (message.version !== 0) throw new Error("Expected v0 message");
  assert.equal(message.instructions.length, 3);
  assert.equal(await validateOrcaStableUnsigned(value), value);
});

test("absent USDT ATA requires explicit rent-capped creation", async () => {
  const value = await prepareOrcaStableUnsigned(await input(false));
  assert.equal(value.instructionPrograms.length, 4);
  const absent = { ...await input(false), createUsdtAta: false };
  await assert.rejects(prepareOrcaStableUnsigned(absent), (error) => reason(error) === "orca_stable_destination_absent");
  const overCap = { ...await input(false), maximumAtaRentLamports: "1000000" };
  await assert.rejects(prepareOrcaStableUnsigned(overCap), (error) => reason(error) === "orca_stable_rent_cap");
});

test("snapshot, ownership, amount, expiry and message mutations fail closed", async () => {
  const base = await input();
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAtaAddress: base.snapshot.usdtAtaAddress } }),
    (error) => reason(error) === "orca_stable_ata_mismatch");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAta: token(USDC_MINT, base.owner, 1n) } }),
    (error) => reason(error) === "orca_stable_balance");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAta: token(USDC_MINT, SYSTEM_PROGRAM, 2_000_000n) } }),
    (error) => reason(error) === "orca_stable_ata_state");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, quote: { ...base.quote, pool: SYSTEM_PROGRAM } }),
    (error) => reason(error) === "orca_stable_pin_drift");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, lifetime: { ...base.lifetime, currentBlockHeight: "400000100" } }),
    (error) => reason(error) === "orca_stable_lifetime");
  const preview = await prepareOrcaStableUnsigned(base);
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, amountInAtomic: "1000001" }),
    (error) => reason(error) === "orca_stable_message_data");
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, unsignedPayload: preview.unsignedPayload.slice(0, -4) + "AAAA" }),
    (error) => error instanceof ApnError);
});
