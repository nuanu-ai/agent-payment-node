// Fresh public capture of Whirlpool ProgramData after the slot 457152296 upgrade. Runtime bytes only; never executed locally.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sha256 } from "../../../src/canonical.js";

export const WHIRLPOOL_C422B2 = Object.freeze({
 deploymentSlot: "457152296", upgradeAuthority: "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV", space: 10_485_760,
 headerHash: "fabfdb127c040782f2ba077df7cbc62185c14a036c8d136e0fed4fac3e7f1bdf",
 payloadHash: "c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f",
 programDataHash: "a49ebc534880f4aaf525b5fd1504aed6223928bdbbea6c83d40473eb17abd04e",
 gzipHash: "68b75585c33a9c510bc7a7e8f972e16f410024773bc1237df4e4c817febe6cfe",
});
const compressed = readFileSync(new URL("./programdata.bin.gz", import.meta.url));
if (sha256(compressed) !== WHIRLPOOL_C422B2.gzipHash) throw Error("Public Whirlpool TEST capture changed");
const data = gunzipSync(compressed);
if (data.length !== WHIRLPOOL_C422B2.space || sha256(data) !== WHIRLPOOL_C422B2.programDataHash ||
 sha256(data.subarray(0, 45)) !== WHIRLPOOL_C422B2.headerHash || sha256(data.subarray(45)) !== WHIRLPOOL_C422B2.payloadHash ||
 data.readBigUInt64LE(4).toString() !== WHIRLPOOL_C422B2.deploymentSlot) throw Error("Public Whirlpool TEST bytes changed");

/** A fresh copy each call, so a test can flip bytes without touching other tests. */
export function whirlpoolC422b2ProgramData(): Buffer { return Buffer.from(data); }
