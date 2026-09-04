import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageNameFromLocation(location) {
  const marker = "node_modules/";
  const index = location.lastIndexOf(marker);
  if (index === -1) throw new Error(`invalid lockfile package location: ${location}`);
  return location.slice(index + marker.length);
}

function purlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const separator = name.indexOf("/");
  if (separator === -1) throw new Error(`invalid scoped package name: ${name}`);
  return `%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
}

function spdxId(name, version, location) {
  const slug = `${name}-${version}`.replace(/[^A-Za-z0-9.-]+/g, ".");
  return `SPDXRef-Package-${slug}-${sha256(location).slice(0, 12)}`;
}

function parentSearchLocation(location) {
  const marker = "/node_modules/";
  const index = location.lastIndexOf(marker);
  return index === -1 ? "" : location.slice(0, index);
}

function allows(values, target) {
  if (!Array.isArray(values) || values.length === 0) return true;
  if (values.includes(`!${target}`)) return false;
  const positive = values.filter((value) => !value.startsWith("!"));
  return positive.length === 0 || positive.includes(target);
}

function platformCompatible(metadata, target) {
  return allows(metadata.os, target.os) && allows(metadata.cpu, target.cpu);
}

function resolveDependency(packages, fromLocation, dependencyName, optional, target) {
  let searchLocation = fromLocation;
  for (;;) {
    const candidate = searchLocation === ""
      ? `node_modules/${dependencyName}`
      : `${searchLocation}/node_modules/${dependencyName}`;
    if (Object.hasOwn(packages, candidate)) {
      if (platformCompatible(packages[candidate], target)) return candidate;
      if (optional) return null;
      throw new Error(`locked dependency is incompatible with ${target.os}-${target.cpu}: ${dependencyName}`);
    }
    if (searchLocation === "") break;
    searchLocation = parentSearchLocation(searchLocation);
  }
  if (optional) return null;
  throw new Error(`locked production dependency is unresolved: ${dependencyName} from ${fromLocation || "root"}`);
}

function declaredDependencies(metadata) {
  const dependencies = new Map();
  for (const name of Object.keys(metadata.dependencies ?? {})) {
    dependencies.set(name, false);
  }
  for (const name of Object.keys(metadata.optionalDependencies ?? {})) {
    dependencies.set(name, true);
  }
  for (const name of Object.keys(metadata.peerDependencies ?? {})) {
    const optional = metadata.peerDependenciesMeta?.[name]?.optional === true;
    if (!dependencies.has(name)) dependencies.set(name, optional);
  }
  return [...dependencies.entries()].sort(([left], [right]) => lexicalCompare(left, right));
}

export function productionGraph(lockfile) {
  if (lockfile.lockfileVersion !== 3 || lockfile.packages?.[""] === undefined) {
    throw new Error("package-lock.json must use lockfileVersion 3 with a root package");
  }
  const packages = lockfile.packages;
  const root = packages[""];
  if (root.os?.length !== 1 || root.cpu?.length !== 1 ||
      root.os[0].startsWith("!") || root.cpu[0].startsWith("!")) {
    throw new Error("root package must declare one positive target OS and CPU");
  }
  const target = { os: root.os[0], cpu: root.cpu[0] };
  const queue = declaredDependencies(packages[""]).map(([name, optional]) => ({
    from: "",
    name,
    optional,
  }));
  const visited = new Set();
  const edges = [];
  while (queue.length > 0) {
    const dependency = queue.shift();
    const location = resolveDependency(
      packages,
      dependency.from,
      dependency.name,
      dependency.optional,
      target,
    );
    if (location === null) continue;
    edges.push({ from: dependency.from, to: location });
    if (visited.has(location)) continue;
    visited.add(location);
    for (const [name, optional] of declaredDependencies(packages[location])) {
      queue.push({ from: location, name, optional });
    }
  }
  return {
    locations: [...visited].sort(),
    edges: edges
      .filter(({ from, to }, index, rows) => rows.findIndex((row) =>
        row.from === from && row.to === to) === index)
      .sort((left, right) => lexicalCompare(`${left.from}\0${left.to}`, `${right.from}\0${right.to}`)),
  };
}

function checksumFromIntegrity(integrity) {
  if (typeof integrity !== "string") return [];
  const match = integrity.match(/(?:^|\s)sha512-([A-Za-z0-9+/=]+)(?:\s|$)/);
  if (match === null) return [];
  return [{ algorithm: "SHA512", checksumValue: Buffer.from(match[1], "base64").toString("hex") }];
}

function license(metadata) {
  return typeof metadata.license === "string" && metadata.license.length > 0
    ? metadata.license
    : "NOASSERTION";
}

function parseEpoch(value) {
  if (!/^(?:0|[1-9][0-9]{0,11})$/.test(value ?? "")) {
    throw new Error("--source-date-epoch must be a non-negative integer");
  }
  const epoch = Number(value);
  const date = new Date(epoch * 1000);
  if (!Number.isSafeInteger(epoch) || Number.isNaN(date.valueOf())) {
    throw new Error("--source-date-epoch is outside the supported range");
  }
  return date.toISOString();
}

export function buildProductionSbom({ packageJson, lockfile, lockBytes, created }) {
  if (packageJson.name !== lockfile.name || packageJson.version !== lockfile.version) {
    throw new Error("package.json and package-lock.json root identity differ");
  }
  const graph = productionGraph(lockfile);
  const rootId = spdxId(packageJson.name, packageJson.version, "root");
  const ids = new Map([["", rootId]]);
  for (const location of graph.locations) {
    const metadata = lockfile.packages[location];
    const name = metadata.name ?? packageNameFromLocation(location);
    ids.set(location, spdxId(name, metadata.version, location));
  }
  const rootPackage = {
    name: packageJson.name,
    SPDXID: rootId,
    versionInfo: packageJson.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: typeof packageJson.license === "string" ? packageJson.license : "NOASSERTION",
    copyrightText: "NOASSERTION",
    externalRefs: [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:npm/${purlName(packageJson.name)}@${encodeURIComponent(packageJson.version)}`,
    }],
  };
  const dependencyPackages = graph.locations.map((location) => {
    const metadata = lockfile.packages[location];
    const name = metadata.name ?? packageNameFromLocation(location);
    const entry = {
      name,
      SPDXID: ids.get(location),
      versionInfo: metadata.version,
      downloadLocation: metadata.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: license(metadata),
      copyrightText: "NOASSERTION",
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${purlName(name)}@${encodeURIComponent(metadata.version)}`,
      }],
    };
    const checksums = checksumFromIntegrity(metadata.integrity);
    if (checksums.length > 0) entry.checksums = checksums;
    return entry;
  });
  const relationships = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootId,
    },
    ...graph.edges.map(({ from, to }) => ({
      spdxElementId: ids.get(from),
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: ids.get(to),
    })),
  ];
  const lockHash = sha256(lockBytes);
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${packageJson.name}@${packageJson.version}`,
    documentNamespace: `https://github.com/nuanu-ai/agent-payment-node/sbom/${packageJson.version}/${lockHash}`,
    creationInfo: {
      created,
      creators: ["Tool: @nuanu-ai/apn/scripts/generate-sbom.mjs"],
    },
    documentDescribes: [rootId],
    packages: [rootPackage, ...dependencyPackages],
    relationships,
  };
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--output", "--source-date-epoch"].includes(key) || value === undefined) {
      throw new Error("usage: generate-sbom.mjs --output <path> --source-date-epoch <seconds>");
    }
    if (values[key] !== undefined) throw new Error(`duplicate argument: ${key}`);
    values[key] = value;
  }
  if (values["--output"] === undefined || values["--source-date-epoch"] === undefined) {
    throw new Error("--output and --source-date-epoch are required");
  }
  return values;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const [packageBytes, lockBytes, shrinkwrapBytes] = await Promise.all([
    readFile(resolve(sourceRoot, "package.json")),
    readFile(resolve(sourceRoot, "package-lock.json")),
    readFile(resolve(sourceRoot, "npm-shrinkwrap.json")),
  ]);
  if (!lockBytes.equals(shrinkwrapBytes)) {
    throw new Error("package-lock.json and npm-shrinkwrap.json differ");
  }
  const sbom = buildProductionSbom({
    packageJson: JSON.parse(packageBytes),
    lockfile: JSON.parse(lockBytes),
    lockBytes,
    created: parseEpoch(arguments_["--source-date-epoch"]),
  });
  await writeFile(resolve(arguments_["--output"]), `${JSON.stringify(sbom, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  process.stdout.write(`wrote production SPDX SBOM (${sbom.packages.length} packages)\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
