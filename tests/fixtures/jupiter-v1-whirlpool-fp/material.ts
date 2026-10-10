// SYNTHETIC TEST MODEL. Historical program bytes and modeled slots/fee/height are not live evidence.
import { fixture as oldFixture } from "../jupiter-v1/material.js";
import { capturedFp } from "./capture.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "../../../src/swap/jupiter-solana/v1-resolver.js";
import { jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash } from "../../../src/swap/jupiter-solana/v1-codec.js";
import { JUPITER_V1_RUNTIME_PROGRAM_PINS } from "../../../src/swap/jupiter-solana/v1-pins.js";
import { JUPITER_V1_MATERIAL_SCHEMA, jupiterV1MaterialDigest } from "../../../src/swap/jupiter-solana/v1-material.js";
export function syntheticFpMaterial() {
 const c = capturedFp(), old = oldFixture(), slot = String(c.quote.contextSlot + 1);
 for (const pin of JUPITER_V1_RUNTIME_PROGRAM_PINS) c.accounts.push(old.semanticAccounts.find(a => a.address === pin.programDataAddress)!);
 const semanticAccounts = c.accounts.map(a => ({ ...a, slot })), payer = c.build.swapInstruction.accounts[1]!.pubkey;
 const addressTables = c.build.addressLookupTableAddresses.map(k => decodeJupiterV1AddressTable(semanticAccounts.find(a => a.address === k)!));
 const programPins = old.programPins.map(pin => ({ ...pin, accountHash: semanticAccounts.find(a => a.address === pin.programId)!.dataHash }));
 const body = { schemaVersion: JUPITER_V1_MATERIAL_SCHEMA, genesis: old.genesis, payer, quoteResponse: c.quote, rawBuildResponse: c.build,
   quoteResponseHash: jupiterV1ResponseHash(c.quote), rawBuildResponseHash: jupiterV1ResponseHash(c.build), lifetime: jupiterV1Lifetime(c.build),
   ...assembleJupiterV1(payer,c.build,addressTables), rawInstructions: jupiterV1Instructions(c.build), semanticAccounts, addressTables, programPins,
   accountSlot: slot, currentBlockHeight: "0", networkFeeLamports: "6400", tokenAccountRentLamports: "1488440", maximumNativeExpenseLamports: "6000000" };
 return { ...body, materialDigest: jupiterV1MaterialDigest(body) };
}
