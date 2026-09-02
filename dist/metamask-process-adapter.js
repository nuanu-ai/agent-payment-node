import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { accountBindingHash, metamaskDirectCapabilitySnapshot } from "./provider-profile.js";
import { MetaMaskDirectAdapter } from "./metamask-direct-adapter.js";
import { MetaMaskX402Adapter } from "./metamask-x402-adapter.js";
import { parseMetaMaskProcessOutput } from "./metamask-process-output.js";
import { NodeMetaMaskProcessRunner } from "./metamask-process-runner.js";
export const METAMASK_AGENT_WALLET_PROVIDER_ID = "metamask-agent-wallet";
export const METAMASK_AGENT_WALLET_AUTHENTICATION_METHODS = ["qr", "browser"];
export class MetaMaskProcessAdapter {
    runner;
    exclusive;
    now;
    direct;
    x402Signer;
    capabilities = metamaskDirectCapabilitySnapshot();
    authenticationMethods = METAMASK_AGENT_WALLET_AUTHENTICATION_METHODS;
    constructor(runner = new NodeMetaMaskProcessRunner(), exclusive = async (work) => await work(), now = () => new Date(), direct = new MetaMaskDirectAdapter(runner, exclusive), x402Signer = new MetaMaskX402Adapter(runner, exclusive)) {
        this.runner = runner;
        this.exclusive = exclusive;
        this.now = now;
        this.direct = direct;
        this.x402Signer = x402Signer;
    }
    bundle() {
        return {
            provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
            trust_class: "provider_managed_non_custodial_signer",
            capabilities: this.capabilities,
            lifecycle: this,
            reads: this,
            direct: this.direct,
            x402Signer: this.x402Signer,
            evidence: { owner: "apn" },
        };
    }
    async connect(_foreground, options = {}) {
        await this.exclusive(async () => {
            const authenticationMethod = requireAuthenticationMethod(options.authenticationMethod);
            let status = await this.doctor();
            if (!status.authenticated) {
                const exitCode = await this.runner.runForeground(authenticationMethod === "browser"
                    ? ["login", "browser", "--otp-pair"]
                    : ["login", "qr"]);
                if (exitCode !== 0)
                    throw authenticationFailure();
                status = await this.doctor();
            }
            if (!status.authenticated)
                throw authenticationFailure();
            if (!status.initialized) {
                const initialized = await this.runner.runJson([
                    "init", "--wallet", "server-wallet", "--mode", "guard", "--json",
                ]);
                try {
                    requireSuccess(initialized.exitCode, initialized.stdout);
                }
                finally {
                    initialized.stdout.fill(0);
                }
                status = await this.doctor();
            }
            if (!status.authenticated || !status.initialized)
                throw sessionFailure();
            await this.readAddressUnlocked();
        });
    }
    async probeStatus() {
        await this.exclusive(async () => {
            const status = await this.doctor();
            if (!status.authenticated || !status.initialized)
                throw sessionFailure();
        });
    }
    async logout() {
        await this.exclusive(async () => {
            const result = await this.runner.runJson(["logout", "--json"]);
            try {
                requireSuccess(result.exitCode, result.stdout);
            }
            finally {
                result.stdout.fill(0);
            }
        });
    }
    async observeBalance() {
        return await this.exclusive(async () => {
            const address = await this.readAddressUnlocked();
            return {
                address,
                account_binding_hash: accountBindingHash(METAMASK_AGENT_WALLET_PROVIDER_ID, address),
                chain: "base",
                asset: "USDC",
                raw: "0",
                formatted: "observed independently by APN Base RPC",
                decimals: 6,
                observed_at: this.now().toISOString(),
            };
        });
    }
    async crossCheckAddress(expected) {
        await this.exclusive(async () => {
            const observed = await this.readAddressUnlocked();
            if (observed.toLowerCase() !== expected.toLowerCase())
                throw profileDrift();
        });
    }
    async doctor() {
        const result = await this.runner.runJson(["doctor", "--json"]);
        try {
            const data = requireSuccess(result.exitCode, result.stdout);
            if (typeof data.authenticated !== "boolean" || typeof data.initialized !== "boolean" || data.cli !== "6.1.5") {
                throw providerProtocol();
            }
            return { authenticated: data.authenticated, initialized: data.initialized };
        }
        finally {
            result.stdout.fill(0);
        }
    }
    async readAddressUnlocked() {
        const result = await this.runner.runJson(["wallet", "address", "--chain-namespace", "evm", "--json"]);
        try {
            const data = requireSuccess(result.exitCode, result.stdout);
            if (typeof data.address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(data.address))
                throw providerProtocol();
            return data.address;
        }
        finally {
            result.stdout.fill(0);
        }
    }
}
function requireAuthenticationMethod(input) {
    const selected = input ?? "qr";
    if (selected !== "qr" && selected !== "browser") {
        throw new ApnError("APN_INVALID_INPUT", "MetaMask Agent Wallet supports only qr or browser authentication.");
    }
    return selected;
}
function requireSuccess(exitCode, bytes) {
    const parsed = parseMetaMaskProcessOutput(bytes);
    const value = parsed?.envelope;
    if (exitCode !== 0 || !isPlainRecord(value) || value.ok !== true || !isPlainRecord(value.data)) {
        throw exitCode === 0 ? providerProtocol() : sessionFailure();
    }
    return value.data;
}
function authenticationFailure() {
    return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "MetaMask Agent Wallet foreground authentication did not complete.");
}
function sessionFailure() {
    return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "The MetaMask Agent Wallet session is unavailable or not initialized.");
}
function profileDrift() {
    return new ApnError("APN_PROFILE_DRIFT", "The active MetaMask Agent Wallet address changed.", { retryable: false });
}
function providerProtocol() {
    return new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask Agent Wallet returned an unsupported safe response.", { retryable: false });
}
//# sourceMappingURL=metamask-process-adapter.js.map