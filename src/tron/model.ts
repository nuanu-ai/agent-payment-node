/** The finite java-tron charging contract reviewed for this payment profile. */
export interface TronFeeParameters {
  readonly bandwidthPriceAtomic: string;
  readonly energyPriceAtomic: string;
  readonly systemCreateFeeAtomic: string;
  readonly fixedCreateBandwidthFeeAtomic: string;
  readonly createBandwidthRateAtomic: string;
  readonly maximumFeeLimitAtomic: string;
  readonly maximumCreateAccountBytesAtomic: string;
  readonly vmEnabled: true;
  readonly consensusExpiryEnabled: true;
}

export interface TronResourceSnapshot {
  readonly schemaVersion: "apn.tron-resources.v1";
  readonly protocolVersion: "4.8.2.1";
  readonly parameters: TronFeeParameters;
  readonly parameterHash: string;
  readonly referenceBlockId: string;
  readonly referenceBlockNumberAtomic: string;
  readonly referenceTimestampMsAtomic: string;
  readonly nextMaintenanceMsAtomic: string;
  readonly expirationMsAtomic: string;
  readonly rawDataBytesAtomic: string;
  readonly bandwidthBytesAtomic: string;
  readonly bandwidthMaximumAtomic: string;
  readonly energyFeeLimitAtomic: string;
  readonly energyEstimateAtomic: string;
  readonly accountActivationMaximumAtomic: string;
  readonly recipientActivatedAtSolidHead: boolean;
  readonly recipientSolidHeadNumberAtomic: string;
  readonly recipientSolidHeadId: string;
  readonly totalFeeMaximumAtomic: string;
  readonly costRule: "ordinary_bandwidth" | "native_activation_or_bandwidth" | "energy_limit_plus_bandwidth";
}

/** Current state reads supplement the exact transaction; they are not deltas. */
export interface TronBalanceObservation {
  readonly scope: "current_solidified_state";
  readonly atOrAfterBlockNumberAtomic: string;
  readonly senderBalanceAtomic: string;
  readonly recipientBalanceAtomic: string;
}

export interface TronFinalResources {
  readonly schemaVersion: "apn.tron-resource-evidence.v1";
  readonly parentBlockId: string;
  readonly parentBlockNumberAtomic: string;
  readonly parentTimestampMsAtomic: string;
  readonly blockTimestampMsAtomic: string;
  readonly totalFeeAtomic: string;
  readonly bandwidthFeeAtomic: string;
  readonly bandwidthUsageAtomic: string;
  readonly energyFeeAtomic: string;
  readonly energyUsageAtomic: string;
  readonly originEnergyUsageAtomic: string;
  readonly totalEnergyUsageAtomic: string;
  readonly accountActivationFeeAtomic: string;
  readonly contractResult: "SUCCESS" | "REVERT";
  readonly balanceObservation: TronBalanceObservation;
}
