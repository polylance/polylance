import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { DemoRole } from '../types';
import { RPC_URL } from '../config/contracts';

export const DEMO_WALLETS = {
  visitor: {
    address: '',
    label: 'Anonymous Visitor',
    isArbitrator: false,
    isTreasuryAdmin: false,
    reputationCount: 0,
  },
  client: {
    address: '0x9999888877776666555544443333222211110000',
    label: 'Client (Project Owner)',
    isArbitrator: false,
    isTreasuryAdmin: false,
    reputationCount: 0,
  },
  freelancer: {
    address: '0x3333444455556666777788889999000011112222',
    label: 'Freelancer (Dev)',
    isArbitrator: false,
    isTreasuryAdmin: false,
    reputationCount: 4, // 4 completed jobs SBT
  },
  judge: {
    address: '0x62cD88889999000011112222333344445555dCba',
    label: 'Judge / Arbitrator',
    isArbitrator: true,
    isTreasuryAdmin: false,
    reputationCount: 12,
  },
  admin: {
    address: '0x25F6111122223333444455556666777788880e9A',
    label: 'Treasury Admin (Safe Multisig)',
    isArbitrator: false,
    isTreasuryAdmin: true,
    reputationCount: 1,
  },
};

interface Web3ContextType {
  currentRole: DemoRole;
  setRole: (role: DemoRole) => void;
  address: string;
  isConnected: boolean;
  isArbitrator: boolean;
  isTreasuryAdmin: boolean;
  reputationCount: number;
  provider: ethers.Provider;
  getSigner: () => Promise<ethers.Signer | null>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

const Web3Context = createContext<Web3ContextType | undefined>(undefined);

export const Web3Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRole] = useState<DemoRole>(() => {
    const saved = localStorage.getItem('polylance_demo_role');
    return (saved as DemoRole) || 'visitor';
  });
  const [customAddress, setCustomAddress] = useState<string | null>(null);

  const walletInfo = DEMO_WALLETS[currentRole];
  const address = customAddress || walletInfo.address;
  const isConnected = currentRole !== 'visitor' || !!customAddress;

  const browserProviderRef = useRef<ethers.BrowserProvider | null>(null);
  const fallbackProviderRef = useRef<ethers.JsonRpcProvider | null>(null);

  const getActiveProvider = (): ethers.Provider => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      if (!browserProviderRef.current) {
        // Prevent MaxListeners warning by increasing max listeners limit if supported
        if (typeof (window as any).ethereum.setMaxListeners === 'function') {
          try {
            (window as any).ethereum.setMaxListeners(30);
          } catch {}
        }
        browserProviderRef.current = new ethers.BrowserProvider((window as any).ethereum);
      }
      return browserProviderRef.current;
    }
    if (!fallbackProviderRef.current) {
      fallbackProviderRef.current = new ethers.JsonRpcProvider(RPC_URL);
    }
    return fallbackProviderRef.current;
  };

  const [provider, setProvider] = useState<ethers.Provider>(() => getActiveProvider());

  useEffect(() => {
    const activeProvider = getActiveProvider();
    setProvider(activeProvider);

    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts && accounts[0]) {
          setCustomAddress(accounts[0]);
        } else {
          setCustomAddress(null);
        }
      };

      const ethereumObj = (window as any).ethereum;
      if (ethereumObj.on) {
        ethereumObj.on('accountsChanged', handleAccountsChanged);
      }

      return () => {
        if (ethereumObj.removeListener) {
          ethereumObj.removeListener('accountsChanged', handleAccountsChanged);
        }
      };
    }
  }, []);

  const getSigner = async (): Promise<ethers.Signer | null> => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        if (!browserProviderRef.current) {
          browserProviderRef.current = new ethers.BrowserProvider((window as any).ethereum);
        }
        return await browserProviderRef.current.getSigner();
      } catch (err) {
        console.warn('Failed to get signer from window.ethereum:', err);
      }
    }
    return null;
  };

  const setRole = (role: DemoRole) => {
    setCustomAddress(null);
    setCurrentRole(role);
    localStorage.setItem('polylance_demo_role', role);
  };

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          setCustomAddress(accounts[0]);
          if (currentRole === 'visitor') {
            setRole('freelancer');
          }
        }
      } catch (err) {
        console.error('User rejected wallet connection', err);
      }
    } else {
      setRole('visitor');
    }
  };

  const disconnectWallet = () => {
    setCustomAddress(null);
    setRole('visitor');
  };

  return (
    <Web3Context.Provider
      value={{
        currentRole,
        setRole,
        address,
        isConnected,
        isArbitrator: walletInfo.isArbitrator,
        isTreasuryAdmin: walletInfo.isTreasuryAdmin,
        reputationCount: walletInfo.reputationCount,
        provider,
        getSigner,
        connectWallet,
        disconnectWallet,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
};

export const useWeb3 = () => {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3 must be used within a Web3Provider');
  }
  return context;
};
