export type WalletAdapter = {
  connectWallet: () => Promise<string>;
  getConnectedWallet: () => Promise<string | null>;
  switchNetwork?: () => Promise<void>;
};

export type WalletState = {
  address: string | null;
  connecting: boolean;
  error: string | null;
};
