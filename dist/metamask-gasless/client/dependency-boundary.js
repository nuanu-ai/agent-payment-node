import { registerHooks } from "node:module";
const blocked = new Set(["@metamask/fox-sdk/wallets/solana", "@solana/spl-token",
    "@solana/buffer-layout-utils", "bigint-buffer"]);
const blockedPath = /(?:^|\/)node_modules\/(?:@metamask\/fox-sdk\/dist\/wallets\/solana|@solana\/(?:spl-token|buffer-layout-utils)|bigint-buffer)(?:\/|$)/u;
/** The gasless helper supports EVM only. Reject any transitive Solana decoder load. */
export function installGaslessDependencyBoundary() {
    registerHooks({ resolve(specifier, context, nextResolve) {
            if (blocked.has(specifier) || blockedPath.test(specifier))
                throw new Error("gasless dependency boundary rejected Solana decoder");
            const resolved = nextResolve(specifier, context);
            if (blockedPath.test(resolved.url))
                throw new Error("gasless dependency boundary rejected Solana decoder");
            return resolved;
        } });
}
//# sourceMappingURL=dependency-boundary.js.map