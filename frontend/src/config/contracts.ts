import localAddresses from "./localhost_addresses.json";
import amoyAddresses from "./amoy_addresses.json";
import polygonAddresses from "./polygon_addresses.json";

const network = import.meta.env.VITE_NETWORK ?? "polygon";
const manifest = 
  network === "amoy" 
    ? amoyAddresses 
    : network === "localhost" 
      ? localAddresses 
      : polygonAddresses;

export const CONTRACTS = {
  JobFactory: manifest.JobFactory,
  ReputationSBT: manifest.ReputationSBT,
  ProfileRegistry: manifest.ProfileRegistry,
  GithubReputationRegistry: manifest.GithubReputationRegistry,
  JudgeDAO: manifest.JudgeDAO,
  TimelockController: manifest.TimelockController,
} as const;

export const CONTRACT_ADDRESSES = CONTRACTS;

export const CHAIN_ID = 
  network === "amoy" 
    ? 80002 
    : network === "localhost" 
      ? 31337 
      : 137;

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  (network === "amoy"
    ? "https://polygon-amoy-bor-rpc.publicnode.com"
    : network === "localhost"
      ? "http://127.0.0.1:8545"
      : "https://polygon-bor-rpc.publicnode.com");

export const NETWORK_CONFIG = {
  chainId: CHAIN_ID,
  chainHex: `0x${CHAIN_ID.toString(16)}`,
  chainName: 
    CHAIN_ID === 137
      ? "Polygon Mainnet"
      : CHAIN_ID === 31337 
        ? "Hardhat Localhost" 
        : "Polygon Amoy Testnet",
  nativeCurrency: {
    name: CHAIN_ID === 137 ? "POL" : "MATIC",
    symbol: CHAIN_ID === 137 ? "POL" : "MATIC",
    decimals: 18,
  },
  rpcUrl: RPC_URL,
  blockExplorerUrl: 
    CHAIN_ID === 137
      ? "https://polygonscan.com"
      : CHAIN_ID === 31337 
        ? "" 
        : "https://amoy.polygonscan.com",
};

