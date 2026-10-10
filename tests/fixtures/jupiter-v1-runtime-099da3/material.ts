// SYNTHETIC mixed-slot model. Only JUP6 ProgramData bytes below are a fresh public capture.
// Historical Fp market accounts and modeled fee/height/simulation are not live acceptance.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { getAddressDecoder } from "@solana/kit";
import { sha256 } from "../../../src/canonical.js";
import { syntheticFpMaterial } from "../jupiter-v1-whirlpool-fp/material.js";
import { fixture } from "../jupiter-v1/material.js";
import { jupiterV1MaterialDigest, type JupiterV1ResolvedMaterial } from "../../../src/swap/jupiter-solana/v1-material.js";
import { JUPITER_V6_PROGRAM } from "../../../src/swap/jupiter-solana/catalog.js";
const compressed = readFileSync(new URL("./programdata.bin.gz", import.meta.url));
if (sha256(compressed) !== "1fd92282f850b60a1217839021427e99c8a745dc51fe1da370021735e2c3b4b9") throw Error("Public JUP6 TEST capture changed");
const data = gunzipSync(compressed);
if (data.length !== 2892269 || sha256(data) !== "3bd95cf0775979fdaed8a383474461d538a6ef040303f161abf9ed8c40dbc517" ||
 sha256(data.subarray(45)) !== "099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f") throw Error("Public JUP6 TEST bytes changed");
export function syntheticRuntime099da3Material(pool: "fp" | "83" = "fp"): JupiterV1ResolvedMaterial {
 const m = pool === "fp" ? syntheticFpMaterial() : fixture(), jup = m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!;
 const semanticAccounts = m.semanticAccounts.map(a => ({...a, slot: "454594650", ...(a.address === jup.programDataAddress ? {
  dataBase64: data.toString("base64"), dataHash: sha256(data)
 } : {})}));
 const programPins = m.programPins.map(p => p.programId === JUPITER_V6_PROGRAM ? {...p,
  deploymentSlot: data.readBigUInt64LE(4).toString(), upgradeAuthority: getAddressDecoder().decode(data.subarray(13,45)),
  programDataHash: sha256(data), storedPayloadHash: sha256(data.subarray(45))
 } : p);
 const {materialDigest: _digest, ...original} = m;
 const addressTables = m.addressTables.map(t => ({...t, account: semanticAccounts.find(a => a.address === t.account.address)!}));
 const body = {...original, semanticAccounts, addressTables, programPins, accountSlot: "454594650"};
 return {...body, materialDigest: jupiterV1MaterialDigest(body)};
}
