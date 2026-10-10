import { registerHooks } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const blocked = new Set(["@metamask/fox-sdk/wallets/solana", "@solana/spl-token",
  "@solana/buffer-layout-utils", "bigint-buffer"]);
const blockedPath = /(?:^|\/)node_modules\/(?:@metamask\/fox-sdk\/dist\/wallets\/solana|@solana\/(?:spl-token|buffer-layout-utils)|bigint-buffer)(?:\/|$)/u;
const reviewedVersions = new Map([
  ["axios", new Set(["0.34.0", "1.20.0"])], ["fast-uri", new Set(["3.1.8"])],
  ["brace-expansion", new Set(["5.0.12"])], ["pbkdf2", new Set(["3.1.7"])],
]);
const reviewedPackagePath = /^(.*\/node_modules\/(axios|fast-uri|brace-expansion|pbkdf2))\//u;

function checkReviewedVersion(specifier: string, resolvedUrl: string, checked: Set<string>): void {
  const requestedName = specifier.split("/")[0]!;
  const match = resolvedUrl.startsWith("file:") ? reviewedPackagePath.exec(fileURLToPath(resolvedUrl)) : null;
  if (match === null) {
    if (reviewedVersions.has(requestedName)) rejectVersion();
    return;
  }
  const packageRoot = match[1]!, name = match[2]!;
  if (checked.has(packageRoot)) return;
  try {
    const path = `${packageRoot}/package.json`;
    if (statSync(path).size > 65_536) rejectVersion();
    const metadata: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof metadata !== "object" || metadata === null || !("name" in metadata) || metadata.name !== name ||
      !("version" in metadata) || typeof metadata.version !== "string" || !reviewedVersions.get(name)!.has(metadata.version)) rejectVersion();
  } catch { rejectVersion(); }
  checked.add(packageRoot);
}
function rejectVersion(): never { throw new Error("APN dependency boundary rejected unreviewed package version"); }

/** Reject the affected Solana decoder before loading any APN runtime module. */
export function installRuntimeDependencyBoundary(): void {
  const checked = new Set<string>();
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (blocked.has(specifier) || blockedPath.test(specifier)) throw new Error("APN dependency boundary rejected Solana decoder");
    const resolved = nextResolve(specifier, context);
    if (blockedPath.test(resolved.url)) throw new Error("APN dependency boundary rejected Solana decoder");
    checkReviewedVersion(specifier, resolved.url, checked);
    return resolved;
  } });
}
