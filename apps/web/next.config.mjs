/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @privy-io/react-auth v3 bundles optional integrations (fiat on-ramp, Farcaster,
    // Solana, etc.) that pull in peer deps we don't install. Stub them all out.
    const optionalPrivyDeps = [
      '@stripe/crypto',
      '@farcaster/mini-app-solana',
      '@farcaster/frame-sdk',
      '@solana/web3.js',
      '@solana/wallet-adapter-base',
      'bs58',
    ];
    for (const dep of optionalPrivyDeps) {
      config.resolve.alias[dep] = false;
    }
    return config;
  },
};

export default nextConfig;
