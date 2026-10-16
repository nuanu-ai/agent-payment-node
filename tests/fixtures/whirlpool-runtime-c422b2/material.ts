// SYNTHETIC mixed-slot model. Only the Whirlpool and JUP6 ProgramData bytes are fresh public captures.
// Historical pool/tick/oracle accounts and modeled fee, height and simulation are not live acceptance.
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { sha256 } from "../../../src/canonical.js";
import { ADDRESS_LOOKUP_TABLE_PROGRAM, JUPITER_V6_PROGRAM } from "../../../src/swap/jupiter-solana/catalog.js";
import { jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash } from "../../../src/swap/jupiter-solana/v1-codec.js";
import { jupiterV1MaterialDigest, type JupiterV1ResolvedMaterial } from "../../../src/swap/jupiter-solana/v1-material.js";
import { JUPITER_V1_WHIRLPOOL_PROGRAM } from "../../../src/swap/jupiter-solana/v1-pins.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "../../../src/swap/jupiter-solana/v1-resolver.js";
import { captured4H } from "../jupiter-v1-whirlpool-4h/capture.js";
import { syntheticV2Material } from "../jupiter-v1-whirlpool-v2/refusal-vectors.js";
import { syntheticRuntime099da3Material } from "../jupiter-v1-runtime-099da3/material.js";
import { whirlpoolC422b2ProgramData } from "./programdata.js";

export type C422b2Lane = "83" | "fp" | "esv" | "4h";

function rehash(m: JupiterV1ResolvedMaterial, patch: Partial<JupiterV1ResolvedMaterial>): JupiterV1ResolvedMaterial {
 const { materialDigest: _digest, ...original } = m, body = { ...original, ...patch };
 return { ...body, materialDigest: jupiterV1MaterialDigest(body) };
}

/** Same layout as the SwapV2 runtime snapshot test: historical Esv or 4H accounts under the JUP6 099da3 bytes. */
function swapV2Runtime099da3(lane: "esv" | "4h"): JupiterV1ResolvedMaterial {
 let m = syntheticV2Material();
 if (lane === "4h") {
  const c = captured4H(), slot = "454594650";
  for (const p of m.programPins) if (p.programDataAddress !== null && !c.accounts.some(a => a.address === p.programDataAddress))
   c.accounts.push({ ...m.semanticAccounts.find(a => a.address === p.programDataAddress)! });
  // The diagnostic capture has no ALT response. This TEST-only table holds its instruction addresses; not a chain claim.
  const keys = [...new Set(jupiterV1Instructions(c.build).flatMap(ix => ix.accounts.map(a => a.pubkey)))].filter(k => k !== m.payer);
  for (const tableAddress of c.build.addressLookupTableAddresses) {
   const data = Buffer.alloc(56 + keys.length * 32); data.writeUInt32LE(1, 0);
   data.writeBigUInt64LE((1n << 64n) - 1n, 4); data.writeBigUInt64LE(BigInt(slot) - 1n, 12);
   keys.forEach((key, i) => Buffer.from(getAddressEncoder().encode(address(key))).copy(data, 56 + i * 32));
   c.accounts.push({ address: tableAddress, slot, existence: "present", owner: ADDRESS_LOOKUP_TABLE_PROGRAM,
    executable: false, lamports: "1000000", dataBase64: data.toString("base64"), dataHash: sha256(data) });
  }
  const accounts = c.accounts.map(a => ({ ...a, slot }));
  const addressTables = c.build.addressLookupTableAddresses.map(k => decodeJupiterV1AddressTable(accounts.find(a => a.address === k)!));
  m = rehash(m, { quoteResponse: c.quote, rawBuildResponse: c.build, quoteResponseHash: jupiterV1ResponseHash(c.quote),
   rawBuildResponseHash: jupiterV1ResponseHash(c.build), lifetime: jupiterV1Lifetime(c.build), ...assembleJupiterV1(m.payer, c.build, addressTables),
   rawInstructions: jupiterV1Instructions(c.build), semanticAccounts: accounts, addressTables, accountSlot: slot });
 }
 const donor = syntheticRuntime099da3Material("83"), pin = donor.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!;
 const jup = donor.semanticAccounts.find(a => a.address === pin.programDataAddress)!;
 const semanticAccounts = m.semanticAccounts.map(a => ({ ...a, slot: donor.accountSlot,
  ...(a.address === pin.programDataAddress ? { dataBase64: jup.dataBase64, dataHash: jup.dataHash } : {}) }));
 const addressTables = m.addressTables.map(t => ({ ...t, account: semanticAccounts.find(a => a.address === t.account.address)! }));
 return rehash(m, { semanticAccounts, addressTables, accountSlot: donor.accountSlot,
  programPins: m.programPins.map(p => p.programId === JUPITER_V6_PROGRAM ? { ...pin } : p) });
}

/** A registered JUP6 099da3 material for the lane, still carrying the previous Whirlpool executable bytes. */
export function runtime099da3Material(lane: C422b2Lane): JupiterV1ResolvedMaterial {
 return lane === "83" || lane === "fp" ? syntheticRuntime099da3Material(lane) : swapV2Runtime099da3(lane);
}

/** Replaces only the Whirlpool ProgramData account and its runtime pin row; every other byte stays the same. */
export function withWhirlpoolProgramData(m: JupiterV1ResolvedMaterial, data: Buffer): JupiterV1ResolvedMaterial {
 const row = m.programPins.find(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM)!;
 const semanticAccounts = m.semanticAccounts.map(a => a.address === row.programDataAddress ?
  { ...a, dataBase64: data.toString("base64"), dataHash: sha256(data) } : a);
 const addressTables = m.addressTables.map(t => ({ ...t, account: semanticAccounts.find(a => a.address === t.account.address)! }));
 const programPins = m.programPins.map(p => p.programId !== JUPITER_V1_WHIRLPOOL_PROGRAM ? p : { ...p,
  deploymentSlot: data.readBigUInt64LE(4).toString(), upgradeAuthority: data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null,
  programDataHash: sha256(data), storedPayloadHash: sha256(data.subarray(45)) });
 return rehash(m, { semanticAccounts, addressTables, programPins });
}

/** The c422b2 generation for one lane: JUP6 099da3 plus the Whirlpool bytes deployed at slot 457152296. */
export function syntheticC422b2Material(lane: C422b2Lane): JupiterV1ResolvedMaterial {
 return withWhirlpoolProgramData(runtime099da3Material(lane), whirlpoolC422b2ProgramData());
}
