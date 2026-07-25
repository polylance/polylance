import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { Wallet } from "ethers";

dotenv.config();

const KNOWN_PUBLIC_TEST_KEYS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat default account #0
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Hardhat default account #1
];

function validateDeployerForRealNetwork(privateKey: string | undefined, networkName: string) {
  if (!privateKey) {
    throw new Error(
      `PRIVATE_KEY is not set in environment — cannot deploy to ${networkName}. ` +
      `Refusing to configure a real network without an explicit deployer key.`
    );
  }
  let derivedAddress: string;
  try {
    derivedAddress = new Wallet(privateKey).address;
  } catch {
    throw new Error(`PRIVATE_KEY is invalid — failed to derive wallet address.`);
  }

  if (KNOWN_PUBLIC_TEST_KEYS.map((a) => a.toLowerCase()).includes(derivedAddress.toLowerCase())) {
    throw new Error(
      `SECURITY EXCEPTION: PRIVATE_KEY resolves to a publicly known test account ` +
      `(${derivedAddress}). This key must NEVER be used for real network deployment (${networkName}). ` +
      `Generate a fresh key and fund it before deploying.`
    );
  }
}

// Enforce guard when targeting non-local networks (e.g. amoy, polygon)
if (process.argv.includes("--network") && !process.argv.includes("hardhat") && !process.argv.includes("localhost")) {
  const networkArgIndex = process.argv.indexOf("--network");
  const targetNetwork = process.argv[networkArgIndex + 1] ?? "real-network";
  validateDeployerForRealNetwork(process.env.PRIVATE_KEY, targetNetwork);
}

const AMOY_RPC_URL = process.env.AMOY_RPC_URL && process.env.AMOY_RPC_URL !== "https://rpc-amoy.polygon.technology"
  ? process.env.AMOY_RPC_URL 
  : "https://polygon-amoy-bor-rpc.publicnode.com";

const amoyAccounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      url: AMOY_RPC_URL,
      accounts: amoyAccounts,
      chainId: 80002,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? "",
    },
  },
};

export default config;
