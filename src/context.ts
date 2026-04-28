import type { Address, Chain, Hex, PublicClient, Transport, WalletClient as ViemWalletClient } from 'viem';
import type { Account } from './types.ts';
import type { AbiEncodedValue } from './abi-wrap.ts';

export type WalletClient = ViemWalletClient<Transport, Chain>;

export interface ConfirmationThreshold {
  etaFromBroadcast: number;
  confirmations: number;
}

export interface SolverContext {
  getPublicClient: (chainId: bigint) => PublicClient;
  getWalletClient: (chainId: bigint) => WalletClient;
  paymentChain: bigint;
  paymentRecipient: Address;
  fillerAddress: Address;
  isWhitelisted: (account: Account, assumption: string) => boolean;
  getWitnessResolver: (kind: string) => WitnessResolver | undefined;

  getTokenPriceUsd: (token: Account) => Promise<bigint>;
  getGasPriceUsd: (chainId: bigint) => Promise<bigint>;

  getConfirmationThreshold: (chainId: bigint, flows: unknown) => ConfirmationThreshold;
  getTimeToBlock: (chainId: bigint, targetBlockNumber: bigint | number, flows: unknown) => Promise<number>;
  getWitnessDelay: (kind: string, data: Hex) => number;


}

interface WitnessResolver {
  resolve(data: Hex, variableValues: AbiEncodedValue[]): Promise<AbiEncodedValue>;
}
