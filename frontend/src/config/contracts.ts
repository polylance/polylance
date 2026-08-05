// Contract configuration for PolyLance Frontend (Single Source of Truth)

export const CONTRACTS = {
  JobFactory:
    import.meta.env.VITE_JOB_FACTORY_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_JOB_FACTORY_ADDRESS ||
    '0x8492796C544989f6F9BaEcEfD2cb8CA49E422776',
  ReputationSBT:
    import.meta.env.VITE_REPUTATION_SBT_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_REPUTATION_SBT_ADDRESS ||
    '0x3CC04FA1E3cae9F831E27B2846F131cD82625Ac9',
  ProfileRegistry:
    import.meta.env.VITE_PROFILE_REGISTRY_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_PROFILE_REGISTRY_ADDRESS ||
    '0x6BB41d9fbDfbe9a86647c98d1cce94fd8776709a',
  GithubReputationRegistry:
    import.meta.env.VITE_GITHUB_REGISTRY_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_GITHUB_REGISTRY_ADDRESS ||
    '0x14f3b20cE067721dCccD0994b08C02a7B3ECB4e3',
  JudgeDAO:
    import.meta.env.VITE_JUDGE_DAO_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_JUDGE_DAO_ADDRESS ||
    '0xffc2b7aba3639F28b566357A2596D407Ec03A745',
  TimelockController:
    import.meta.env.VITE_TIMELOCK_ADDRESS ||
    import.meta.env.NEXT_PUBLIC_TIMELOCK_ADDRESS ||
    '0x2bA85050C8F3Cf9590583c21B262Fee7f829b698',
} as const;

export const CONTRACT_ADDRESSES = CONTRACTS;

export const CHAIN_ID = parseInt(
  import.meta.env.VITE_CHAIN_ID || import.meta.env.NEXT_PUBLIC_CHAIN_ID || '80002'
);

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.NEXT_PUBLIC_RPC_URL ||
  'https://polygon-amoy-bor-rpc.publicnode.com';

export const NETWORK_CONFIG = {
  chainId: CHAIN_ID,
  chainHex: `0x${CHAIN_ID.toString(16)}`,
  chainName: CHAIN_ID === 31337 ? 'Hardhat Localhost' : 'Polygon Amoy Testnet',
  nativeCurrency: {
    name: 'MATIC',
    symbol: 'MATIC',
    decimals: 18,
  },
  rpcUrl: RPC_URL,
  blockExplorerUrl: CHAIN_ID === 31337 ? '' : 'https://amoy.polygonscan.com',
};
