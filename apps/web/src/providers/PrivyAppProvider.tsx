'use client';

import { PrivyProvider } from '@privy-io/react-auth';

export function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // If no Privy App ID is configured, skip the provider — MetaMask fallback remains available
  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        loginMethods: ['email'],
        appearance: {
          theme: 'light',
          accentColor: '#4A9EFF',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
