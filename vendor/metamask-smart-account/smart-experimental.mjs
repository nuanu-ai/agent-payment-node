import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  generateSalt
} from "./chunk-L4R6PIP7.mjs";
import {
  getSmartAccountsEnvironment
} from "./chunk-DQE3KJNP.mjs";
import "./chunk-GHAODLUH.mjs";
import {
  createOpenDelegation,
  decodeDelegations,
  encodeDelegations,
  prepareSignDelegationTypedData,
  resolveCaveats
} from "./chunk-XRTWDKRZ.mjs";
import "./chunk-IMFZ4P7A.mjs";
import {
  pad
} from "./chunk-S2MT4VX5.mjs";
import "./chunk-HMYUAAIA.mjs";
import {
  createAllowedCalldataTerms,
  createRedeemerTerms,
  createTimestampTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms
} from "./chunk-GFNUYFFY.mjs";
import {
  parseCaipChainId
} from "./chunk-T6VOGCFD.mjs";
import "./chunk-ZSEVIWSW.mjs";
import "./chunk-VBXYOQOU.mjs";
import "./chunk-GQCBBNZL.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/experimental/index.mjs
async function resolveMaybeDeferred(maybeDeferred, requirements) {
  if (typeof maybeDeferred === "function") {
    const deferred = maybeDeferred;
    return await deferred(requirements);
  }
  return maybeDeferred;
}
function parseEip155ChainId(network) {
  const { namespace, reference } = parseCaipChainId(
    network
  );
  if (namespace !== "eip155") {
    throw new Error("Unsupported chain namespace");
  }
  const parsedChainId = Number(reference);
  if (isNaN(parsedChainId)) {
    throw new Error("Invalid chain id");
  }
  return parsedChainId;
}
var TRANSFER_PAYEE_INDEX = 4;
var normalizeAddress = (address) => address.toLowerCase();
var hasMatchingCaveats = (caveats, delegations, match) => {
  for (const caveat of caveats) {
    if (match(caveat)) {
      return true;
    }
  }
  for (const delegation of delegations) {
    for (const caveat of delegation.caveats) {
      if (match(caveat)) {
        return true;
      }
    }
  }
  return false;
};
var ensureExpirySufficientlyConstrained = ({
  timestampEnforcer,
  caveats,
  existingDelegations,
  expirySeconds
}) => {
  if (expirySeconds < 0) {
    throw new Error("Expiry seconds must be a positive number");
  }
  const beforeThreshold = Math.floor(Date.now() / 1e3) + expirySeconds;
  const timestampEnforcerNormalized = normalizeAddress(timestampEnforcer);
  const hasSupersedingTimestampConstraint = hasMatchingCaveats(
    caveats,
    existingDelegations,
    (caveat) => {
      if (normalizeAddress(caveat.enforcer) !== timestampEnforcerNormalized) {
        return false;
      }
      const { beforeThreshold: existingBeforeThreshold } = decodeTimestampTerms(
        caveat.terms
      );
      return existingBeforeThreshold !== 0 && existingBeforeThreshold <= beforeThreshold;
    }
  );
  if (hasSupersedingTimestampConstraint) {
    return caveats;
  }
  const timestampCaveat = {
    enforcer: timestampEnforcer,
    terms: createTimestampTerms({
      afterThreshold: 0,
      beforeThreshold
    }),
    args: "0x"
  };
  return [...caveats, timestampCaveat];
};
var resolveRedeemerAddresses = ({
  facilitatorAddresses,
  redeemerAddresses
}) => {
  if (!facilitatorAddresses) {
    if (!redeemerAddresses) {
      return void 0;
    }
    return redeemerAddresses;
  }
  if (!redeemerAddresses) {
    return facilitatorAddresses;
  }
  const normalizedFacilitatorAddresses = facilitatorAddresses.map(normalizeAddress);
  const normalizedRedeemerAddressSet = new Set(
    redeemerAddresses.map(normalizeAddress)
  );
  const redeemerAddressesIntersection = normalizedFacilitatorAddresses.filter(
    (address) => normalizedRedeemerAddressSet.has(address)
  );
  return redeemerAddressesIntersection;
};
var ensureRedeemerSufficientlyConstrained = (config) => {
  const redeemerAddresses = resolveRedeemerAddresses(config);
  if (redeemerAddresses?.length === 0) {
    throw new Error(
      "No valid redeemer addresses were resolved. If both `redeemers.addresses` and `extra.facilitatorAddresses` are provided, they must overlap. If only one is provided, it must include at least one address."
    );
  }
  const { caveats, existingDelegations, redeemerEnforcer } = config;
  const redeemerEnforcerNormalized = normalizeAddress(redeemerEnforcer);
  if (!redeemerAddresses) {
    if (!config.requireRedeemers) {
      return caveats;
    }
    const hasExistingRedeemerCaveat = hasMatchingCaveats(
      caveats,
      existingDelegations,
      ({ enforcer }) => normalizeAddress(enforcer) === redeemerEnforcerNormalized
    );
    if (!hasExistingRedeemerCaveat) {
      throw new Error(
        "Redeemer must be constrained, either in the specified `caveats`, `parentPermissionContext`, or the `PaymentRequirements` as `extra.facilitatorAddresses`."
      );
    }
    return caveats;
  }
  const redeemerAddressesSet = new Set(redeemerAddresses.map(normalizeAddress));
  const hasSupersedingRedeemerCaveat = hasMatchingCaveats(
    caveats,
    existingDelegations,
    (caveat) => {
      if (normalizeAddress(caveat.enforcer) !== redeemerEnforcerNormalized) {
        return false;
      }
      const allowedRedeemerAddresses = decodeRedeemerTerms(
        caveat.terms
      ).redeemers.map(normalizeAddress);
      return allowedRedeemerAddresses.every(
        (item) => redeemerAddressesSet.has(item)
      );
    }
  );
  if (hasSupersedingRedeemerCaveat) {
    return caveats;
  }
  const redeemerCaveat = {
    enforcer: redeemerEnforcer,
    terms: createRedeemerTerms({ redeemers: redeemerAddresses }),
    args: "0x"
  };
  return [...caveats, redeemerCaveat];
};
var ensurePayeeSufficientlyConstrained = ({
  allowedCalldataEnforcer,
  caveats,
  existingDelegations,
  payee
}) => {
  const allowedCalldataTerms = createAllowedCalldataTerms({
    startIndex: TRANSFER_PAYEE_INDEX,
    value: pad(payee, { size: 32 })
  });
  const allowedCalldataEnforcerNormalized = normalizeAddress(
    allowedCalldataEnforcer
  );
  const lowercaseCalldataTerms = allowedCalldataTerms.toLowerCase();
  const hasSupersedingAllowedCalldataConstraint = hasMatchingCaveats(
    caveats,
    existingDelegations,
    ({ enforcer, terms }) => normalizeAddress(enforcer) === allowedCalldataEnforcerNormalized && terms.toLowerCase() === lowercaseCalldataTerms
  );
  if (hasSupersedingAllowedCalldataConstraint) {
    return caveats;
  }
  const payeeCaveat = {
    enforcer: allowedCalldataEnforcer,
    terms: allowedCalldataTerms,
    args: "0x"
  };
  return [...caveats, payeeCaveat];
};
var resolvex402DelegationCaveats = ({
  environment,
  caveatsConfig,
  existingDelegations,
  facilitatorAddresses,
  payee,
  expirySeconds,
  requireRedeemers,
  redeemerAddresses
}) => {
  const {
    caveatEnforcers: {
      RedeemerEnforcer: redeemerEnforcer,
      AllowedCalldataEnforcer: allowedCalldataEnforcer,
      TimestampEnforcer: timestampEnforcer
    }
  } = environment;
  if (!redeemerEnforcer) {
    throw new Error("RedeemerEnforcer not found in environment");
  }
  if (!allowedCalldataEnforcer) {
    throw new Error("AllowedCalldataEnforcer not found in environment");
  }
  if (!timestampEnforcer) {
    throw new Error("TimestampEnforcer not found in environment");
  }
  const initialCaveats = resolveCaveats({
    environment,
    caveats: caveatsConfig,
    // Resolve caveats first so downstream constraint checks can append as needed.
    // Scope is still attached later during delegation creation.
    isScopeOptional: true
  });
  const caveatsWithRedeemer = ensureRedeemerSufficientlyConstrained({
    redeemerEnforcer,
    facilitatorAddresses,
    redeemerAddresses,
    caveats: initialCaveats,
    existingDelegations,
    requireRedeemers
  });
  const caveatsWithPayee = ensurePayeeSufficientlyConstrained({
    allowedCalldataEnforcer,
    caveats: caveatsWithRedeemer,
    existingDelegations,
    payee
  });
  if (expirySeconds === void 0) {
    return caveatsWithPayee;
  }
  return ensureExpirySufficientlyConstrained({
    timestampEnforcer,
    caveats: caveatsWithPayee,
    existingDelegations,
    expirySeconds
  });
};
var resolveDelegationCreationContext = async (config, requirements) => {
  const account = await resolveMaybeDeferred(config.account, requirements);
  const redeemersConfig = await resolveMaybeDeferred(
    config.redeemers,
    requirements
  );
  const requireRedeemers = redeemersConfig?.requireRedeemers ?? false;
  const redeemerAddresses = await resolveMaybeDeferred(
    redeemersConfig?.addresses,
    requirements
  );
  const specifiedEnvironment = await resolveMaybeDeferred(
    config.environment,
    requirements
  );
  const environment = specifiedEnvironment ?? getSmartAccountsEnvironment(parseEip155ChainId(requirements.network));
  const caveatsConfig = await resolveMaybeDeferred(
    config.caveats,
    requirements
  );
  const parentPermissionContext = await resolveMaybeDeferred(config.parentPermissionContext, requirements);
  const expirySeconds = await resolveMaybeDeferred(
    config.expirySeconds,
    requirements
  );
  const from = await resolveMaybeDeferred(config.from, requirements) ?? account.address;
  const salt = await resolveMaybeDeferred(config.salt, requirements) ?? generateSalt();
  const scope = {
    type: "erc20TransferAmount",
    tokenAddress: requirements.asset,
    maxAmount: BigInt(requirements.amount)
  };
  const facilitatorAddresses = requirements.extra?.facilitatorAddresses;
  const existingDelegations = parentPermissionContext ? decodeDelegations(parentPermissionContext) : [];
  const { DelegationManager: delegationManager } = environment;
  const caveats = resolvex402DelegationCaveats({
    environment,
    caveatsConfig,
    existingDelegations,
    facilitatorAddresses,
    payee: requirements.payTo,
    expirySeconds,
    requireRedeemers,
    redeemerAddresses
  });
  let createDelegationConfig;
  if (parentPermissionContext) {
    const parentDelegation = existingDelegations[0];
    if (!parentDelegation) {
      throw new Error("Parent permission context is not a valid delegation");
    }
    createDelegationConfig = {
      environment,
      from,
      caveats,
      salt,
      scope,
      parentDelegation
    };
  } else {
    createDelegationConfig = {
      environment,
      from,
      caveats,
      salt,
      scope
    };
  }
  const rootDelegator = existingDelegations[existingDelegations.length - 1]?.delegator ?? from;
  return {
    account,
    createDelegationConfig,
    delegationManager,
    existingDelegations,
    rootDelegator
  };
};
function createx402DelegationProvider(config) {
  return async (requirements) => {
    const {
      account,
      createDelegationConfig,
      delegationManager,
      existingDelegations,
      rootDelegator
    } = await resolveDelegationCreationContext(config, requirements);
    const delegation = createOpenDelegation(createDelegationConfig);
    const chainId = parseEip155ChainId(requirements.network);
    const typedData = prepareSignDelegationTypedData({
      delegationManager,
      chainId,
      delegation
    });
    if (!account.signTypedData) {
      throw new Error("Account does not support signTypedData");
    }
    const signature = await account.signTypedData(typedData);
    const signedDelegation = {
      ...delegation,
      signature
    };
    const permissionContext = encodeDelegations([
      signedDelegation,
      ...existingDelegations
    ]);
    return {
      delegationManager,
      permissionContext,
      delegator: rootDelegator
    };
  };
}
export {
  createx402DelegationProvider
};
