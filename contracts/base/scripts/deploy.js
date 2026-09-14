// Deploys DeliveraEscrow to Base Sepolia via Hardhat.
//
// Reads everything from environment variables (see .env.example) — NEVER
// pass a private key as a CLI argument or paste one into chat/logs.
//
//   cd contracts/base
//   npm install
//   cp .env.example .env   # then fill in the real values
//   npm run deploy:sepolia
//
const hre = require("hardhat");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

async function main() {
  const usdcAddress =
    process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const relayerAddress = requireEnv("BASE_SEPOLIA_RELAYER_ADDRESS");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying from ${deployer.address} to ${hre.network.name} ...`);

  const DeliveraEscrow = await hre.ethers.getContractFactory("DeliveraEscrow");
  const escrow = await DeliveraEscrow.deploy(usdcAddress, relayerAddress);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("DeliveraEscrow deployed at:", address);
  console.log("\nSet these in backend/.env:");
  console.log(`DELIVERA_ESCROW_ADDRESS=${address}`);
  console.log(`BASE_SEPOLIA_USDC_ADDRESS=${usdcAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
