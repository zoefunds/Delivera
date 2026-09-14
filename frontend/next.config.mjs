/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @coinbase/cdp-sdk (pulled in transitively by @reown/appkit-adapter-ethers's
    // Base Account support) optionally imports @x402/* packages that aren't
    // installed and aren't needed for our wallet-connect + signing flow.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/evm/upto/client": false,
      "@x402/evm/exact/client": false,
      "@x402/core/client": false,
      "@x402/svm/exact/client": false,
      "@x402/evm": false,
    };
    return config;
  },
};

export default nextConfig;
