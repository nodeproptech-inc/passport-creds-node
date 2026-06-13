'use client';

import type { WalletAdapter } from './wallet.types';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isMetaMask?: boolean;
    };
  }
}

export const metamaskAdapter: WalletAdapter = {
  async connectWallet(): Promise<string> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask not found. Please install the MetaMask extension.');
    }
    const accounts = (await window.ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from MetaMask.');
    }
    return accounts[0];
  },

  async getConnectedWallet(): Promise<string | null> {
    if (typeof window === 'undefined' || !window.ethereum) return null;
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_accounts',
      })) as string[];
      return accounts?.[0] ?? null;
    } catch {
      return null;
    }
  },
};
