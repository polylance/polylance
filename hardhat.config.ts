import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { Wallet } from "ethers";

dotenv.config();

const KNOWN_PUBLIC_TEST_KEYS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat default account #0
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Hardhat default account #1
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Hardhat default account #2
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // Hardhat default account #3
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // Hardhat default account #4
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", // Hardhat default account #5
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9", // Hardhat default account #6
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", // Hardhat default account #7
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", // Hardhat default account #8
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720", // Hardhat default account #9
  "0xBcd4042DE499D14e55001CcbB24a551F3A993240", // Hardhat default account #10
  "0x71bE63f3384f5fb98995898A86B02Fb2426c5788", // Hardhat default account #11
  "0xFABB0ac9d68B0B445fB7357272Ff202C5651694a", // Hardhat default account #12
  "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec", // Hardhat default account #13
  "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097", // Hardhat default account #14
  "0xcd3B766CCDd6AE721141F452C550Ca635964ce71", // Hardhat default account #15
  "0x2546BcD3c84621e976D8185a91A922aE77ECEc30", // Hardhat default account #16
  "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E", // Hardhat default account #17
  "0xdD2FD4581271e230360230F9337D5c0430Bf44C0", // Hardhat default account #18
  "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // Hardhat default account #19
];

function validateDeployerForRealNetwork(privateKey: string | undefined, networkName: string, envVarName: string = "PRIVATE_KEY") {
  if (!privateKey || privateKey.trim() === "") {
    throw new Error(
      `${envVarName} is not set in environment — cannot deploy to ${networkName}. ` +
      `Refusing to configure a real network without an explicit deployer key.`
    );
  }
  let derivedAddress: string;
  try {
    derivedAddress = new Wallet(privateKey).address;
  } catch {
    throw new Error(`${envVarName} is invalid — failed to derive wallet address.`);
  }

  if (KNOWN_PUBLIC_TEST_KEYS.map((a) => a.toLowerCase()).includes(derivedAddress.toLowerCase())) {
    throw new Error(
      `SECURITY EXCEPTION: ${envVarName} resolves to a publicly known test account ` +
      `(${derivedAddress}). This key must NEVER be used for real network deployment (${networkName}). ` +
      `Generate a fresh key and fund it before deploying.`
    );
  }
}

// Enforce guard when targeting non-local networks (e.g. amoy, polygon)
if (process.argv.includes("--network") && !process.argv.includes("hardhat") && !process.argv.includes("localhost")) {
  const networkArgIndex = process.argv.indexOf("--network");
  const targetNetwork = process.argv[networkArgIndex + 1] ?? "real-network";
  const isPolygon = targetNetwork === "polygon";
  const keyToValidate = isPolygon 
    ? process.env.MAINNET_DEPLOYER_PRIVATE_KEY 
    : process.env.PRIVATE_KEY;
  const envVar = isPolygon ? "MAINNET_DEPLOYER_PRIVATE_KEY" : "PRIVATE_KEY";
  validateDeployerForRealNetwork(keyToValidate, targetNetwork, envVar);
}

const AMOY_RPC_URL = process.env.AMOY_RPC_URL && process.env.AMOY_RPC_URL !== "https://rpc-amoy.polygon.technology"
  ? process.env.AMOY_RPC_URL 
  : "https://polygon-amoy-bor-rpc.publicnode.com";

const amoyAccounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const POLYGON_MAINNET_RPC_URL = process.env.POLYGON_MAINNET_RPC_URL || "https://polygon-rpc.com";
const polygonAccounts = process.env.MAINNET_DEPLOYER_PRIVATE_KEY ? [process.env.MAINNET_DEPLOYER_PRIVATE_KEY] : [];

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
    hardhat: {
      hardfork: "cancun",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      url: AMOY_RPC_URL,
      accounts: amoyAccounts,
      chainId: 80002,
    },
    polygon: {
      url: POLYGON_MAINNET_RPC_URL,
      accounts: polygonAccounts,
      chainId: 137,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? "",
      polygon: process.env.POLYGONSCAN_API_KEY ?? "",
    },
  },
};

export default config;
