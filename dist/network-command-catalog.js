import { EVM_NETWORKS } from "./evm-asset.js";
export function networkCommandVariants(commands) {
    const paths = new Set(["wallet policy show", "wallet policy set", "x402 inspect", "x402 fetch prepare"]);
    const chain = {
        name: "--chain", type: "string", required: true, default: { kind: "none" },
        constraints: ["enabled_mainnet_caip2", ...EVM_NETWORKS.map((network) => network.caip2)], sensitivity: "operator_input",
    };
    return commands.filter((command) => paths.has(command.path.join(" "))).map((command) => {
        const path = [...command.path.slice(0, -1), `${command.path.at(-1)}-network`];
        return {
            ...command, path,
            synopsis: command.synopsis.replace(`apn ${command.path.join(" ")}`, `apn ${path.join(" ")} --chain <caip2>`),
            summary: `${command.summary} Explicit local-wallet network selection; no cross-network authority inheritance.`,
            options: [chain, ...command.options],
            examples: command.examples.map((example) => example.replace(`apn ${command.path.join(" ")}`, `apn ${path.join(" ")} --chain eip155:1`)),
        };
    });
}
//# sourceMappingURL=network-command-catalog.js.map