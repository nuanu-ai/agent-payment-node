import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { mmAssertSameBinding, mmBinding, mmPrivateHash, mmWalletIdentityHash } from "../identity.js";
import { mmFail } from "../reasons.js";
import { mmAddress, mmExact } from "../validation.js";
const SESSION_MAX = 256 * 1024;
const WALLETS_MAX = 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const CLOSE_ON_EXEC = constants.O_CLOEXEC ?? 0;
export async function readPrivateState(homeDirectory, expected, now) {
    if (typeof homeDirectory !== "string" || homeDirectory.length < 1 || homeDirectory.length > 4096 ||
        !isAbsolute(homeDirectory) || resolve(homeDirectory) !== homeDirectory || !(now instanceof Date) ||
        !Number.isSafeInteger(now.getTime()))
        mmFail("mm_gasless_state_security");
    const directory = join(homeDirectory, ".metamask");
    const directoryGeneration = await assertPrivateDirectories(homeDirectory, directory);
    const firstSession = await secureRead(join(directory, "session.json"), SESSION_MAX);
    const firstWallet = await secureRead(join(directory, "wallets.json"), WALLETS_MAX);
    const secondSession = await secureRead(join(directory, "session.json"), SESSION_MAX);
    const secondWallet = await secureRead(join(directory, "wallets.json"), WALLETS_MAX);
    if (await assertPrivateDirectories(homeDirectory, directory) !== directoryGeneration)
        mmFail("mm_gasless_state_busy");
    if (firstSession.hash !== secondSession.hash || firstWallet.hash !== secondWallet.hash)
        mmFail("mm_gasless_state_busy");
    const sessionEnvelope = parseObject(secondSession.bytes), walletEnvelope = parseObject(secondWallet.bytes);
    const session = validateSession(sessionEnvelope, now), walletState = validateWallet(walletEnvelope);
    const projectId = session.projectId, token = session.cliToken;
    const selected = walletState.selectedWallet;
    const ref = selected.ref;
    const referenceKind = Object.keys(ref)[0];
    if (referenceKind === "id")
        mmFail("mm_gasless_identity");
    const reference = ref[referenceKind];
    const remote = walletState.remoteWallets.filter((row) => row.namespace === "evm");
    const matches = remote.filter((row) => referenceKind === "name" ? row.name === reference :
        typeof row.address === "string" && row.address.toLowerCase() === reference.toLowerCase());
    if (matches.length !== 1)
        mmFail("mm_gasless_identity");
    const address = mmAddress(matches[0].address, "mm_gasless_identity");
    if (address !== expected.address)
        mmFail("mm_gasless_binding_changed");
    const binding = mmBinding({ providerId: "metamask-agent-wallet", address,
        accountBindingHash: expected.accountBindingHash, capabilityHash: expected.capabilityHash, revision: expected.revision,
        projectHash: mmPrivateHash("project", projectId), walletReferenceHash: mmPrivateHash("wallet-reference", reference, referenceKind),
        walletIdHash: mmWalletIdentityHash(address), namespace: "eip155", mode: "server", environment: "prod" });
    if ("providerId" in expected)
        mmAssertSameBinding(binding, expected);
    return { sessionEnvelope, walletEnvelope, session, walletState, token, projectId, address,
        binding, generationHash: sha(`${secondSession.hash}\0${secondWallet.hash}`) };
}
function validateSession(envelope, now) {
    const root = mmExact(envelope, ["schemaVersion", "data"], "mm_gasless_state_corrupt");
    if (root.schemaVersion !== "1.0.0" || !isPlainRecord(root.data))
        mmFail("mm_gasless_state_corrupt");
    const data = root.data;
    for (const key of ["cliToken", "cliRefreshToken", "projectId", "chain", "walletMode", "tradingMode", "authMethod", "loginMethod", "consent"]) {
        if (!Object.hasOwn(data, key))
            mmFail("mm_gasless_state_corrupt");
    }
    if (!boundedString(data.cliToken) || !boundedString(data.projectId) || !nullableString(data.cliRefreshToken) ||
        !nullableString(data.chain) || data.walletMode !== "server-wallet" ||
        ![null, "guard", "beast"].includes(data.tradingMode) || ![null, "qr", "social"].includes(data.authMethod) ||
        ![null, "google", "email", "qr", "other"].includes(data.loginMethod) ||
        !(data.consent === null || (Number.isSafeInteger(data.consent) && Number(data.consent) >= 0 && Number(data.consent) <= 3))) {
        mmFail("mm_gasless_state_corrupt");
    }
    const projectId = data.projectId;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(projectId))
        mmFail("mm_gasless_session_unavailable");
    validateJwt(data.cliToken, projectId, now.getTime());
    return data;
}
function validateWallet(envelope) {
    const root = mmExact(envelope, ["schemaVersion", "data"], "mm_gasless_state_corrupt");
    if (root.schemaVersion !== "0.0.1" || !isPlainRecord(root.data))
        mmFail("mm_gasless_state_corrupt");
    const data = root.data;
    const allowed = new Set(["byokWallets", "remoteWallets", "customEvmChains", "customSolanaChains", "selectedWallet",
        "selectedChain", "pendingJobs", "byokRegisteredAddresses"]);
    if (Object.keys(data).some((key) => !allowed.has(key)) || !Array.isArray(data.byokWallets) || data.byokWallets.length > 128 ||
        !Array.isArray(data.remoteWallets) || data.remoteWallets.length < 1 || data.remoteWallets.length > 128 ||
        !Array.isArray(data.customEvmChains) || data.customEvmChains.length > 128 || !Array.isArray(data.customSolanaChains) ||
        data.customSolanaChains.length > 128 || !Array.isArray(data.pendingJobs) || data.pendingJobs.length > 256 ||
        !isPlainRecord(data.selectedWallet))
        mmFail("mm_gasless_state_corrupt");
    for (const item of data.remoteWallets)
        validateRemote(item);
    const selected = mmExact(data.selectedWallet, ["mode", "namespace", "ref"], "mm_gasless_state_corrupt");
    if (selected.mode !== "server" || selected.namespace !== "evm" || !isPlainRecord(selected.ref))
        mmFail("mm_gasless_identity");
    const refKeys = Object.keys(selected.ref);
    if (refKeys.length !== 1 || !["id", "name", "address"].includes(refKeys[0]) || !boundedString(selected.ref[refKeys[0]])) {
        mmFail("mm_gasless_identity");
    }
    if (refKeys[0] === "address")
        mmAddress(selected.ref.address, "mm_gasless_identity");
    return data;
}
function validateRemote(value) {
    if (!isPlainRecord(value))
        mmFail("mm_gasless_state_corrupt");
    const allowed = new Set(["address", "name", "deviceInfo", "namespace"]);
    if (Object.keys(value).some((key) => !allowed.has(key)) || !boundedString(value.address) ||
        !(value.namespace === undefined || value.namespace === "evm" || value.namespace === "solana") ||
        !(value.name === undefined || boundedString(value.name)) || !(value.deviceInfo === undefined || boundedString(value.deviceInfo))) {
        mmFail("mm_gasless_state_corrupt");
    }
    if (value.namespace !== "solana")
        mmAddress(value.address, "mm_gasless_state_corrupt");
}
function validateJwt(token, projectId, nowMs) {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part) || part.length > 8192)) {
        mmFail("mm_gasless_session_unavailable");
    }
    let payload;
    try {
        const bytes = Buffer.from(parts[1], "base64url");
        if (bytes.toString("base64url") !== parts[1])
            throw new Error();
        payload = JSON.parse(decoder.decode(bytes));
    }
    catch {
        return mmFail("mm_gasless_session_unavailable");
    }
    if (!isPlainRecord(payload) || payload.sub !== projectId || !Number.isSafeInteger(payload.exp) || Number(payload.exp) < 0 ||
        Number(payload.exp) * 1000 <= nowMs)
        mmFail("mm_gasless_session_unavailable");
    for (const key of ["nbf", "iat"]) {
        const value = payload[key];
        if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) * 1000 > nowMs)) {
            mmFail("mm_gasless_session_unavailable");
        }
    }
}
async function secureRead(path, maximum) {
    try {
        const before = await lstat(path, { bigint: true });
        assertMetadata(before, maximum);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | CLOSE_ON_EXEC);
        try {
            const opened = await handle.stat({ bigint: true });
            assertMetadata(opened, maximum);
            assertSame(before, opened);
            const size = Number(opened.size), bytes = Buffer.alloc(size);
            let offset = 0;
            while (offset < size) {
                const read = await handle.read(bytes, offset, size - offset, offset);
                if (read.bytesRead < 1)
                    mmFail("mm_gasless_state_busy");
                offset += read.bytesRead;
            }
            const probe = Buffer.alloc(1);
            if ((await handle.read(probe, 0, 1, size)).bytesRead !== 0)
                mmFail("mm_gasless_state_busy");
            const after = await handle.stat({ bigint: true });
            assertSame(opened, after);
            const final = await lstat(path, { bigint: true });
            assertSame(after, final);
            return { bytes, hash: sha(bytes) };
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (isReason(error))
            throw error;
        if (isFsCode(error, "ENOENT"))
            mmFail("mm_gasless_session_unavailable");
        return mmFail("mm_gasless_state_security");
    }
}
function assertMetadata(stat, maximum) {
    const uid = process.getuid?.();
    if (!stat.isFile() || uid === undefined || stat.uid !== BigInt(uid) || (stat.mode & 63n) !== 0n ||
        stat.size < 1n || stat.size > BigInt(maximum))
        mmFail("mm_gasless_state_security");
}
async function assertPrivateDirectories(home, directory) {
    try {
        await assertNoSymlinkAncestors(home);
        const homeStat = await lstat(home, { bigint: true }), privateStat = await lstat(directory, { bigint: true });
        const uid = process.getuid?.();
        if (uid === undefined || !homeStat.isDirectory() || !privateStat.isDirectory() || homeStat.uid !== BigInt(uid) ||
            privateStat.uid !== BigInt(uid) || (homeStat.mode & 18n) !== 0n || (privateStat.mode & 63n) !== 0n) {
            mmFail("mm_gasless_state_security");
        }
        return [homeStat.dev, homeStat.ino, homeStat.mode, homeStat.uid, homeStat.mtimeNs,
            privateStat.dev, privateStat.ino, privateStat.mode, privateStat.uid, privateStat.mtimeNs].join(":");
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        if (isFsCode(error, "ENOENT"))
            mmFail("mm_gasless_session_unavailable");
        return mmFail("mm_gasless_state_security");
    }
}
async function assertNoSymlinkAncestors(path) {
    const root = parse(path).root;
    let current = root;
    for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
        current = join(current, component);
        const stat = await lstat(current, { bigint: true });
        if (stat.isSymbolicLink() || !stat.isDirectory())
            mmFail("mm_gasless_state_security");
    }
}
function assertSame(a, b) {
    if (a.dev !== b.dev || a.ino !== b.ino || a.mode !== b.mode || a.uid !== b.uid || a.size !== b.size || a.mtimeNs !== b.mtimeNs) {
        mmFail("mm_gasless_state_busy");
    }
}
function parseObject(bytes) {
    try {
        const parsed = JSON.parse(decoder.decode(bytes));
        if (isPlainRecord(parsed))
            return parsed;
    }
    catch { /* fixed failure below */ }
    return mmFail("mm_gasless_state_corrupt");
}
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function boundedString(value) { return typeof value === "string" && value.length > 0 && value.length <= 8192; }
function nullableString(value) { return value === null || boundedString(value); }
function isFsCode(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isReason(error) { return error instanceof ApnError; }
//# sourceMappingURL=private-state.js.map