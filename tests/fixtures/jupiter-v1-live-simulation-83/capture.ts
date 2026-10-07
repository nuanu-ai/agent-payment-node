import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { sha256 } from "../../../src/canonical.js";
import type { JupiterV1ResolvedMaterial } from "../../../src/swap/jupiter-solana/v1-material.js";
export function liveSimulationCapture():{material:JupiterV1ResolvedMaterial;simulation:any} {
 const bytes=readFileSync(new URL("./capture.json.gz",import.meta.url));
 if(sha256(bytes)!=="31de10a8e2df46d8a080a209a697a15d5dd9b45da05f0b6d9f92c9f07f8ce71f")throw Error("Read-only simulation capture changed");
 const stored=JSON.parse(gunzipSync(bytes).toString("utf8"));
 return {material:stored.material,simulation:(parseJsonWithBigInts(stored.rawRpcResponse) as any).result};
}
