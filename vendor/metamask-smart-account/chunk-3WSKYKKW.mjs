import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  read_exports,
  read_exports2,
  read_exports3,
  read_exports4,
  read_exports5
} from "./chunk-KV33L6SU.mjs";
import {
  getSmartAccountsEnvironment,
  prepareSignUserOperationTypedData
} from "./chunk-DQE3KJNP.mjs";
import {
  __export,
  abi,
  createDelegation,
  createExecution,
  createOpenDelegation,
  decodeDelegations,
  encodeDelegations,
  encodeExecutionCalldatas,
  getCode,
  hashDelegation,
  isDefined,
  prepareSignDelegationTypedData,
  toHexOrThrow,
  trackSmartAccountsKitFunctionCall
} from "./chunk-XRTWDKRZ.mjs";
import {
  BaseError,
  concat,
  encodeFunctionData,
  getAddress,
  hexToNumber,
  isAddress,
  isAddressEqual,
  parseAccount,
  toHex
} from "./chunk-S2MT4VX5.mjs";
import {
  ANY_BENEFICIARY
} from "./chunk-GFNUYFFY.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/chunk-Z4MVJILE.mjs
var actions_exports = {};
__export(actions_exports, {
  caveatEnforcerActions: () => caveatEnforcerActions,
  erc7710BundlerActions: () => erc7710BundlerActions,
  erc7710WalletActions: () => erc7710WalletActions,
  erc7715ProviderActions: () => erc7715ProviderActions,
  getErc20PeriodTransferEnforcerAvailableAmount: () => getErc20PeriodTransferEnforcerAvailableAmount,
  getErc20StreamingEnforcerAvailableAmount: () => getErc20StreamingEnforcerAvailableAmount,
  getGrantedExecutionPermissions: () => erc7715GetGrantedExecutionPermissionsAction,
  getMultiTokenPeriodEnforcerAvailableAmount: () => getMultiTokenPeriodEnforcerAvailableAmount,
  getNativeTokenPeriodTransferEnforcerAvailableAmount: () => getNativeTokenPeriodTransferEnforcerAvailableAmount,
  getNativeTokenStreamingEnforcerAvailableAmount: () => getNativeTokenStreamingEnforcerAvailableAmount,
  getSupportedExecutionPermissions: () => erc7715GetSupportedExecutionPermissionsAction,
  isValid7702Implementation: () => isValid7702Implementation,
  redelegatePermissionContextAction: () => redelegatePermissionContextAction,
  redelegatePermissionContextOpenAction: () => redelegatePermissionContextOpenAction,
  requestExecutionPermissions: () => erc7715RequestExecutionPermissionsAction,
  signDelegation: () => signDelegation,
  signDelegationActions: () => signDelegationActions,
  signUserOperation: () => signUserOperation,
  signUserOperationActions: () => signUserOperationActions
});
async function sendTransactionWithDelegationAction(client, args) {
  trackSmartAccountsKitFunctionCall("sendTransactionWithDelegationAction", {
    chainId: client.chain?.id ?? null
  });
  if (!args.to) {
    throw new Error(
      "`to` is required. `sendTransactionWithDelegation` cannot be used to deploy contracts."
    );
  }
  const chainId = client.chain?.id;
  if (!chainId) {
    throw new Error("Chain ID is not set");
  }
  const { DelegationManager: expectedDelegationManager } = getSmartAccountsEnvironment(chainId);
  if (!isAddressEqual(args.delegationManager, expectedDelegationManager)) {
    throw new Error(
      `Invalid DelegationManager: expected ${expectedDelegationManager} for chain ${chainId}, but got ${args.delegationManager}`
    );
  }
  const executions = [
    createExecution({
      target: args.to,
      value: args.value,
      callData: args.data
    })
  ];
  const calldata = encodeFunctionData({
    abi,
    functionName: "redeemDelegations",
    args: [
      [encodeDelegations(args.permissionContext)],
      [
        "0x0000000000000000000000000000000000000000000000000000000000000000"
        /* SingleDefault */
      ],
      encodeExecutionCalldatas([executions])
    ]
  });
  const {
    value: _value,
    permissionContext: _permissionContext,
    delegationManager: _delegationManager,
    ...rest
  } = args;
  const hash = await client.sendTransaction({
    ...rest,
    to: args.delegationManager,
    data: calldata
  });
  return hash;
}
async function sendUserOperationWithDelegationAction(client, parameters) {
  trackSmartAccountsKitFunctionCall("sendUserOperationWithDelegationAction", {
    chainId: client.chain?.id ?? null,
    callCount: parameters.calls.length,
    hasDependencies: parameters.dependencies !== void 0
  });
  if (parameters.dependencies) {
    const { publicClient } = parameters;
    const includedAccountKeys = {};
    const chainId = publicClient.chain?.id;
    if (!chainId) {
      throw new Error("Chain ID is not set");
    }
    const { SimpleFactory } = getSmartAccountsEnvironment(chainId);
    const uniqueDependencies = parameters.dependencies.filter((dependency) => {
      if (!isAddressEqual(dependency.factory, SimpleFactory)) {
        throw new Error(
          `Invalid dependency: ${dependency.factory} is not allowed.`
        );
      }
      const accountKey = concat([dependency.factory, dependency.factoryData]);
      const isDuplicate = includedAccountKeys[accountKey];
      includedAccountKeys[accountKey] = true;
      return !isDuplicate;
    });
    const factoryCalls = (await Promise.all(
      uniqueDependencies.map(async ({ factory, factoryData }) => {
        const isDeployed = await publicClient.call({
          to: factory,
          data: factoryData
        }).then(() => false).catch(() => true);
        if (isDeployed) {
          return void 0;
        }
        return {
          to: factory,
          value: 0n,
          data: factoryData
        };
      })
    )).filter((call) => call !== void 0);
    parameters.calls = [
      ...factoryCalls,
      ...parameters.calls
    ];
  }
  parameters.calls = parameters.calls.map((call) => {
    if (!("permissionContext" in call)) {
      return call;
    }
    const { permissionContext } = call;
    if (!permissionContext) {
      return call;
    }
    return {
      ...call,
      permissionContext: encodeDelegations(permissionContext)
    };
  });
  return client.sendUserOperation(
    parameters
  );
}
function permissionRequestToRpc(parameters) {
  const { chainId, from, expiry, redeemer, payee } = parameters;
  const converter = getPermissionRequestToRpcConverter(
    parameters.permission.type
  );
  const rules = [];
  if (isDefined(expiry)) {
    rules.push({
      type: "expiry",
      data: {
        timestamp: expiry
      }
    });
  }
  if (isDefined(redeemer)) {
    if (redeemer.length === 0) {
      throw new Error(
        "Invalid redeemers: must specify at least one redeemer address"
      );
    }
    const addresses = [];
    for (const addr of redeemer) {
      if (!isAddress(addr)) {
        throw new Error("Invalid redeemers: must be a valid address");
      }
      addresses.push(getAddress(addr));
    }
    rules.push({
      type: "redeemer",
      data: { addresses }
    });
  }
  if (isDefined(payee)) {
    if (payee.length === 0) {
      throw new Error(
        "Invalid payees: must specify at least one payee address"
      );
    }
    const payeeAddresses = [];
    for (const addr of payee) {
      if (!isAddress(addr)) {
        throw new Error("Invalid payees: must be a valid address");
      }
      payeeAddresses.push(getAddress(addr));
    }
    rules.push({
      type: "payee",
      data: { addresses: payeeAddresses }
    });
  }
  const optionalFields = {
    ...from ? { from } : {}
  };
  return {
    ...optionalFields,
    chainId: toHex(chainId),
    permission: converter(parameters.permission),
    to: parameters.to,
    rules
  };
}
function getPermissionRequestToRpcConverter(permissionType) {
  switch (permissionType) {
    case "native-token-stream":
      return (permission) => nativeTokenStreamPermissionToRpc(
        permission
      );
    case "erc20-token-stream":
      return (permission) => erc20TokenStreamPermissionToRpc(
        permission
      );
    case "native-token-periodic":
      return (permission) => nativeTokenPeriodicPermissionToRpc(
        permission
      );
    case "native-token-allowance":
      return (permission) => nativeTokenAllowancePermissionToRpc(
        permission
      );
    case "erc20-token-periodic":
      return (permission) => erc20TokenPeriodicPermissionToRpc(
        permission
      );
    case "erc20-token-allowance":
      return (permission) => erc20TokenAllowancePermissionToRpc(
        permission
      );
    case "erc20-token-revocation":
      return (permission) => erc20TokenRevocationPermissionToRpc(
        permission
      );
    case "token-approval-revocation":
      return (permission) => tokenApprovalRevocationPermissionToRpc(
        permission
      );
    default:
      throw new Error(`Unsupported permission type: ${permissionType}`);
  }
}
function nativeTokenStreamPermissionToRpc(permission) {
  const {
    data: {
      initialAmount,
      justification,
      maxAmount,
      startTime,
      amountPerSecond
    },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(initialAmount) && {
      initialAmount: toHexOrThrow(initialAmount, "initialAmount")
    },
    ...isDefined(maxAmount) && {
      maxAmount: toHexOrThrow(maxAmount, "maxAmount")
    },
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "native-token-stream",
    data: {
      amountPerSecond: toHexOrThrow(amountPerSecond, "amountPerSecond"),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function erc20TokenStreamPermissionToRpc(permission) {
  const {
    data: {
      tokenAddress,
      amountPerSecond,
      initialAmount,
      startTime,
      maxAmount,
      justification
    },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(initialAmount) && {
      initialAmount: toHexOrThrow(initialAmount, "initialAmount")
    },
    ...isDefined(maxAmount) && {
      maxAmount: toHexOrThrow(maxAmount, "maxAmount")
    },
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "erc20-token-stream",
    data: {
      tokenAddress: toHexOrThrow(tokenAddress, "tokenAddress"),
      amountPerSecond: toHexOrThrow(amountPerSecond, "amountPerSecond"),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function nativeTokenPeriodicPermissionToRpc(permission) {
  const {
    data: { periodAmount, periodDuration, startTime, justification },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "native-token-periodic",
    data: {
      periodAmount: toHexOrThrow(periodAmount, "periodAmount"),
      periodDuration: Number(periodDuration),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function erc20TokenPeriodicPermissionToRpc(permission) {
  const {
    data: {
      tokenAddress,
      periodAmount,
      periodDuration,
      startTime,
      justification
    },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "erc20-token-periodic",
    data: {
      tokenAddress: toHexOrThrow(tokenAddress, "tokenAddress"),
      periodAmount: toHexOrThrow(periodAmount, "periodAmount"),
      periodDuration: Number(periodDuration),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function nativeTokenAllowancePermissionToRpc(permission) {
  const {
    data: { allowanceAmount, startTime, justification },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "native-token-allowance",
    data: {
      allowanceAmount: toHexOrThrow(allowanceAmount, "allowanceAmount"),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function erc20TokenAllowancePermissionToRpc(permission) {
  const {
    data: { tokenAddress, allowanceAmount, startTime, justification },
    isAdjustmentAllowed
  } = permission;
  const optionalFields = {
    ...isDefined(startTime) && {
      startTime: Number(startTime)
    },
    ...justification ? { justification } : {}
  };
  return {
    type: "erc20-token-allowance",
    data: {
      tokenAddress: toHexOrThrow(tokenAddress, "tokenAddress"),
      allowanceAmount: toHexOrThrow(allowanceAmount, "allowanceAmount"),
      ...optionalFields
    },
    isAdjustmentAllowed
  };
}
function erc20TokenRevocationPermissionToRpc(permission) {
  const {
    data: { justification },
    isAdjustmentAllowed
  } = permission;
  const data = {
    ...justification ? { justification } : {}
  };
  return {
    type: "erc20-token-revocation",
    data,
    isAdjustmentAllowed
  };
}
function tokenApprovalRevocationPermissionToRpc(permission) {
  const {
    data: {
      erc20Approve,
      erc721Approve,
      erc721SetApprovalForAll,
      permit2Approve,
      permit2Lockdown,
      permit2InvalidateNonces,
      justification
    },
    isAdjustmentAllowed
  } = permission;
  const data = {
    erc20Approve,
    erc721Approve,
    erc721SetApprovalForAll,
    permit2Approve,
    permit2Lockdown,
    permit2InvalidateNonces,
    ...justification ? { justification } : {}
  };
  return {
    type: "token-approval-revocation",
    data,
    isAdjustmentAllowed
  };
}
function permissionResponsesFromRpc(result) {
  return result.map((permission) => ({
    ...permission,
    chainId: hexToNumber(permission.chainId),
    permission: permissionTypeFromRpc(permission.permission),
    rules: normalizeRulesFromRpc(permission.rules)
  }));
}
function normalizeRulesFromRpc(rules) {
  if (rules === void 0 || rules === null) {
    return rules;
  }
  return rules.map((rule) => {
    if (rule.type !== "redeemer" && rule.type !== "payee") {
      return rule;
    }
    const rawAddresses = rule.data?.addresses;
    if (!Array.isArray(rawAddresses)) {
      return rule;
    }
    return {
      type: rule.type,
      data: {
        addresses: rawAddresses.map((addr) => getAddress(addr))
      }
    };
  });
}
function permissionTypeFromRpc(permission) {
  const convertedData = { ...permission.data };
  if ("amountPerSecond" in convertedData && convertedData.amountPerSecond) {
    convertedData.amountPerSecond = BigInt(
      convertedData.amountPerSecond
    );
  }
  if ("periodAmount" in convertedData && convertedData.periodAmount) {
    convertedData.periodAmount = BigInt(
      convertedData.periodAmount
    );
  }
  if ("initialAmount" in convertedData && convertedData.initialAmount) {
    convertedData.initialAmount = BigInt(
      convertedData.initialAmount
    );
  }
  if ("maxAmount" in convertedData && convertedData.maxAmount) {
    convertedData.maxAmount = BigInt(convertedData.maxAmount);
  }
  if ("allowanceAmount" in convertedData && convertedData.allowanceAmount) {
    convertedData.allowanceAmount = BigInt(
      convertedData.allowanceAmount
    );
  }
  return {
    ...permission,
    data: convertedData
  };
}
function rpcSupportedPermissionsToDeveloper(result) {
  const converted = {};
  for (const [permissionType, permissionInfo] of Object.entries(result)) {
    converted[permissionType] = {
      chainIds: permissionInfo.chainIds.map((chainId) => hexToNumber(chainId)),
      ruleTypes: permissionInfo.ruleTypes
    };
  }
  return converted;
}
async function erc7715GetGrantedExecutionPermissionsAction(client) {
  trackSmartAccountsKitFunctionCall(
    "erc7715GetGrantedExecutionPermissionsAction",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const result = await client.request(
    {
      method: "wallet_getGrantedExecutionPermissions",
      params: []
    },
    { retryCount: 0 }
  );
  if (!result) {
    throw new Error("Failed to get granted execution permissions");
  }
  return permissionResponsesFromRpc(result);
}
async function erc7715GetSupportedExecutionPermissionsAction(client) {
  trackSmartAccountsKitFunctionCall(
    "erc7715GetSupportedExecutionPermissionsAction",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const result = await client.request(
    {
      method: "wallet_getSupportedExecutionPermissions",
      params: []
    },
    { retryCount: 0 }
  );
  if (!result) {
    throw new Error("Failed to get supported execution permissions");
  }
  return rpcSupportedPermissionsToDeveloper(result);
}
async function erc7715RequestExecutionPermissionsAction(client, parameters) {
  trackSmartAccountsKitFunctionCall(
    "erc7715RequestExecutionPermissionsAction",
    {
      chainId: client.chain?.id ?? null,
      requestCount: parameters.length
    }
  );
  const formattedPermissionRequest = parameters.map(permissionRequestToRpc);
  const result = await client.request(
    {
      method: "wallet_requestExecutionPermissions",
      params: formattedPermissionRequest
    },
    { retryCount: 0 }
  );
  if (!result) {
    throw new Error("Failed to grant permissions");
  }
  return permissionResponsesFromRpc(result);
}
async function signDelegation(client, parameters) {
  const {
    account: accountParam = client.account,
    delegation,
    delegationManager,
    chainId,
    name = "DelegationManager",
    version = "1",
    allowInsecureUnrestrictedDelegation = false
  } = parameters;
  if (!accountParam) {
    throw new BaseError("Account not found. Please provide an account.");
  }
  const account = parseAccount(accountParam);
  const typedData = prepareSignDelegationTypedData({
    delegation,
    delegationManager,
    chainId,
    name,
    version,
    allowInsecureUnrestrictedDelegation
  });
  return client.signTypedData({
    account,
    ...typedData
  });
}
function signDelegationActions() {
  return (client) => ({
    signDelegation: async (parameters) => signDelegation(client, {
      chainId: parameters.chainId ?? (() => {
        if (!client.chain?.id) {
          throw new BaseError(
            "Chain ID is required. Either provide it in parameters or configure the client with a chain."
          );
        }
        return client.chain.id;
      })(),
      ...parameters
    })
  });
}
async function signAndPrependRedelegation(client, options) {
  const { account, environment, delegations, unsignedDelegation, chainId } = options;
  const signature = await signDelegation(client, {
    account,
    delegation: unsignedDelegation,
    delegationManager: environment.DelegationManager,
    chainId,
    // Redelegations always inherit from a parent delegation (enforced by
    // `resolveRedelegationArgs`), so the parent's caveats provide the
    // restriction even when the redelegation itself adds no extra caveats.
    // This mirrors `resolveCaveats`, which also allows empty caveats in this
    // case.
    allowInsecureUnrestrictedDelegation: true
  });
  const signedDelegation = {
    ...unsignedDelegation,
    signature
  };
  const newPermissionContext = encodeDelegations([
    signedDelegation,
    ...delegations
  ]);
  return {
    delegation: signedDelegation,
    permissionContext: newPermissionContext
  };
}
function resolveRedelegationArgs(client, parameters) {
  const { account: accountParam = client.account, permissionContext } = parameters;
  if (!accountParam) {
    throw new BaseError("Account not found. Please provide an account.");
  }
  const account = parseAccount(accountParam);
  const delegations = decodeDelegations(permissionContext);
  const parentDelegation = delegations[0];
  if (!parentDelegation) {
    throw new BaseError(
      "Permission context must contain at least one delegation"
    );
  }
  const isParentOpenDelegation = parentDelegation.delegate.toLowerCase() === ANY_BENEFICIARY.toLowerCase();
  const from = isParentOpenDelegation ? account.address : parentDelegation.delegate;
  return { account, delegations, parentDelegation, from };
}
async function redelegatePermissionContextAction(client, parameters) {
  const { environment, scope, caveats, salt, to } = parameters;
  const chainId = resolveChainId(client, parameters.chainId);
  const { account, delegations, parentDelegation, from } = resolveRedelegationArgs(client, parameters);
  trackSmartAccountsKitFunctionCall("redelegatePermissionContext", {
    chainId,
    hasScope: scope !== void 0,
    hasCaveats: caveats !== void 0
  });
  const unsignedDelegation = createDelegation({
    environment,
    from,
    to,
    scope,
    caveats,
    parentDelegation,
    salt
  });
  return signAndPrependRedelegation(client, {
    account,
    environment,
    delegations,
    unsignedDelegation,
    chainId
  });
}
async function redelegatePermissionContextOpenAction(client, parameters) {
  const { environment, scope, caveats, salt } = parameters;
  const chainId = resolveChainId(client, parameters.chainId);
  const { account, delegations, parentDelegation, from } = resolveRedelegationArgs(client, parameters);
  trackSmartAccountsKitFunctionCall("redelegatePermissionContextOpen", {
    chainId,
    hasScope: scope !== void 0,
    hasCaveats: caveats !== void 0
  });
  const unsignedDelegation = createOpenDelegation({
    environment,
    from,
    scope,
    caveats,
    parentDelegation,
    salt
  });
  return signAndPrependRedelegation(client, {
    account,
    environment,
    delegations,
    unsignedDelegation,
    chainId
  });
}
function resolveChainId(client, chainId) {
  if (chainId !== void 0) {
    return chainId;
  }
  if (!client.chain?.id) {
    throw new BaseError(
      "Chain ID is required. Either provide it in parameters or configure the client with a chain."
    );
  }
  return client.chain.id;
}
function findMatchingCaveat({
  delegation,
  enforcerAddress,
  enforcerName
}) {
  const matchingCaveats = delegation.caveats.filter(
    (caveat) => caveat.enforcer.toLowerCase() === enforcerAddress.toLowerCase()
  );
  if (matchingCaveats.length === 0) {
    throw new Error(`No caveat found with enforcer matching ${enforcerName}`);
  }
  if (matchingCaveats.length > 1) {
    throw new Error(
      `Multiple caveats found with enforcer matching ${enforcerName}`
    );
  }
  const [{ terms, args }] = matchingCaveats;
  return {
    terms,
    args
  };
}
function getDelegationManager(environment) {
  if (!environment.DelegationManager) {
    throw new Error("Delegation manager address not found");
  }
  return environment.DelegationManager;
}
function getEnforcerAddress({
  enforcerName,
  environment
}) {
  const enforcerAddress = environment.caveatEnforcers[enforcerName];
  if (!enforcerAddress) {
    throw new Error(`${enforcerName} not found in environment`);
  }
  return enforcerAddress;
}
async function getErc20PeriodTransferEnforcerAvailableAmount(client, environment, params) {
  trackSmartAccountsKitFunctionCall(
    "getErc20PeriodTransferEnforcerAvailableAmount",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const enforcerName = "ERC20PeriodTransferEnforcer";
  const delegationManager = getDelegationManager(environment);
  const enforcerAddress = getEnforcerAddress({
    enforcerName,
    environment
  });
  const delegationHash = hashDelegation(params.delegation);
  const { terms } = findMatchingCaveat({
    delegation: params.delegation,
    enforcerAddress,
    enforcerName
  });
  return read_exports.getAvailableAmount({
    client,
    contractAddress: enforcerAddress,
    delegationHash,
    delegationManager,
    terms
  });
}
async function getErc20StreamingEnforcerAvailableAmount(client, environment, params) {
  trackSmartAccountsKitFunctionCall(
    "getErc20StreamingEnforcerAvailableAmount",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const enforcerName = "ERC20StreamingEnforcer";
  const delegationManager = getDelegationManager(environment);
  const enforcerAddress = getEnforcerAddress({
    enforcerName,
    environment
  });
  const delegationHash = hashDelegation(params.delegation);
  const { terms } = findMatchingCaveat({
    delegation: params.delegation,
    enforcerAddress,
    enforcerName
  });
  return read_exports2.getAvailableAmount({
    client,
    contractAddress: enforcerAddress,
    delegationManager,
    delegationHash,
    terms
  });
}
async function getMultiTokenPeriodEnforcerAvailableAmount(client, environment, params) {
  trackSmartAccountsKitFunctionCall(
    "getMultiTokenPeriodEnforcerAvailableAmount",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const enforcerName = "MultiTokenPeriodEnforcer";
  const delegationManager = getDelegationManager(environment);
  const enforcerAddress = getEnforcerAddress({
    enforcerName,
    environment
  });
  const delegationHash = hashDelegation(params.delegation);
  const { terms, args } = findMatchingCaveat({
    delegation: params.delegation,
    enforcerAddress,
    enforcerName
  });
  return read_exports3.getAvailableAmount({
    client,
    contractAddress: enforcerAddress,
    delegationHash,
    delegationManager,
    terms,
    args
  });
}
async function getNativeTokenPeriodTransferEnforcerAvailableAmount(client, environment, params) {
  trackSmartAccountsKitFunctionCall(
    "getNativeTokenPeriodTransferEnforcerAvailableAmount",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const enforcerName = "NativeTokenPeriodTransferEnforcer";
  const delegationManager = getDelegationManager(environment);
  const enforcerAddress = getEnforcerAddress({
    enforcerName,
    environment
  });
  const delegationHash = hashDelegation(params.delegation);
  const { terms } = findMatchingCaveat({
    delegation: params.delegation,
    enforcerAddress,
    enforcerName
  });
  return read_exports4.getAvailableAmount({
    client,
    contractAddress: enforcerAddress,
    delegationHash,
    delegationManager,
    terms
  });
}
async function getNativeTokenStreamingEnforcerAvailableAmount(client, environment, params) {
  trackSmartAccountsKitFunctionCall(
    "getNativeTokenStreamingEnforcerAvailableAmount",
    {
      chainId: client.chain?.id ?? null
    }
  );
  const enforcerName = "NativeTokenStreamingEnforcer";
  const delegationManager = getDelegationManager(environment);
  const enforcerAddress = getEnforcerAddress({
    enforcerName,
    environment
  });
  const delegationHash = hashDelegation(params.delegation);
  const { terms } = findMatchingCaveat({
    delegation: params.delegation,
    enforcerAddress,
    enforcerName
  });
  return read_exports5.getAvailableAmount({
    client,
    contractAddress: enforcerAddress,
    delegationManager,
    delegationHash,
    terms
  });
}
var caveatEnforcerActions = ({ environment }) => (client) => ({
  /**
   * Get available amount for ERC20 period transfer enforcer.
   *
   * @param params - The parameters for the ERC20 period transfer enforcer.
   * @returns Promise resolving to the period transfer result.
   */
  getErc20PeriodTransferEnforcerAvailableAmount: async (params) => {
    return getErc20PeriodTransferEnforcerAvailableAmount(
      client,
      environment,
      params
    );
  },
  /**
   * Get available amount for ERC20 streaming enforcer.
   *
   * @param params - The parameters for the ERC20 streaming enforcer.
   * @returns Promise resolving to the streaming result.
   */
  getErc20StreamingEnforcerAvailableAmount: async (params) => {
    return getErc20StreamingEnforcerAvailableAmount(
      client,
      environment,
      params
    );
  },
  /**
   * Get available amount for multi-token period enforcer.
   *
   * @param params - The parameters for the multi-token period enforcer.
   * @returns Promise resolving to the period transfer result.
   */
  getMultiTokenPeriodEnforcerAvailableAmount: async (params) => {
    return getMultiTokenPeriodEnforcerAvailableAmount(
      client,
      environment,
      params
    );
  },
  /**
   * Get available amount for native token period transfer enforcer.
   *
   * @param params - The parameters for the native token period transfer enforcer.
   * @returns Promise resolving to the period transfer result.
   */
  getNativeTokenPeriodTransferEnforcerAvailableAmount: async (params) => {
    return getNativeTokenPeriodTransferEnforcerAvailableAmount(
      client,
      environment,
      params
    );
  },
  /**
   * Get available amount for native token streaming enforcer.
   *
   * @param params - The parameters for the native token streaming enforcer.
   * @returns Promise resolving to the streaming result.
   */
  getNativeTokenStreamingEnforcerAvailableAmount: async (params) => {
    return getNativeTokenStreamingEnforcerAvailableAmount(
      client,
      environment,
      params
    );
  }
});
var DELEGATION_PREFIX = "0xef0100";
function extractDelegatedAddress(code) {
  if (code?.length !== 48) {
    return null;
  }
  if (!code.toLowerCase().startsWith(DELEGATION_PREFIX.toLowerCase())) {
    return null;
  }
  const addressHex = code.slice(8);
  return `0x${addressHex}`;
}
async function isValid7702Implementation({
  client,
  accountAddress,
  environment
}) {
  try {
    const code = await getCode(client, {
      address: accountAddress
    });
    const delegatedAddress = extractDelegatedAddress(code);
    if (!delegatedAddress) {
      return false;
    }
    const expectedImplementation = environment.implementations.EIP7702StatelessDeleGatorImpl;
    if (!expectedImplementation) {
      return false;
    }
    return isAddressEqual(delegatedAddress, expectedImplementation);
  } catch {
    return false;
  }
}
async function signUserOperation(client, parameters) {
  const {
    account: accountParam = client.account,
    userOperation,
    entryPoint,
    chainId,
    name,
    address,
    version = "1"
  } = parameters;
  if (!accountParam) {
    throw new BaseError("Account not found. Please provide an account.");
  }
  const account = parseAccount(accountParam);
  const typedData = prepareSignUserOperationTypedData({
    userOperation,
    entryPoint,
    chainId,
    name,
    address,
    version
  });
  return client.signTypedData({
    account,
    ...typedData
  });
}
function signUserOperationActions() {
  return (client) => ({
    signUserOperation: async (parameters) => signUserOperation(client, {
      chainId: parameters.chainId ?? (() => {
        if (!client.chain?.id) {
          throw new BaseError(
            "Chain ID is required. Either provide it in parameters or configure the client with a chain."
          );
        }
        return client.chain.id;
      })(),
      ...parameters
    })
  });
}
var erc7715ProviderActions = () => (client) => ({
  requestExecutionPermissions: async (parameters) => {
    return erc7715RequestExecutionPermissionsAction(
      client,
      parameters
    );
  },
  getSupportedExecutionPermissions: async () => {
    return erc7715GetSupportedExecutionPermissionsAction(
      client
    );
  },
  getGrantedExecutionPermissions: async () => {
    return erc7715GetGrantedExecutionPermissionsAction(
      client
    );
  }
});
var erc7710WalletActions = () => (client) => ({
  sendTransactionWithDelegation: async (args) => sendTransactionWithDelegationAction(client, args),
  redelegatePermissionContext: async (parameters) => redelegatePermissionContextAction(client, parameters),
  redelegatePermissionContextOpen: async (parameters) => redelegatePermissionContextOpenAction(client, parameters)
});
var erc7710BundlerActions = () => (client) => ({
  sendUserOperationWithDelegation: async (args) => sendUserOperationWithDelegationAction(client, args)
});

export {
  redelegatePermissionContextAction,
  getErc20PeriodTransferEnforcerAvailableAmount
};
