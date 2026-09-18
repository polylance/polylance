# PolyLance — Complete Setup Guide

This document is the single reference guide for setting up, configuring, compiling, testing, deploying, and bootstrapping PolyLance.

---

## 🚀 Quickstart Steps

1. **Environment Configuration**
   - Copy `.env.example` → `.env` (in root)
   - Copy `frontend/.env.example` → `frontend/.env.local` (or `.env.local` in root)

2. **RPC Setup**
   - Fill in `POLYGON_MAINNET_RPC_URL` / `RPC_URL` with a Polygon Mainnet RPC endpoint (e.g. Alchemy, Infura, or public Bor RPC).

3. **Deployer Wallet**
   - Generate a fresh deployer wallet private key funded with POL for deployment gas.

4. **Deploy Smart Contracts**
   ```bash
   npx hardhat run scripts/deploy.ts --network polygon
   ```
   - This deploys all 7 core contracts: `JobEscrowImplementation`, `ReputationSBT`, `JobFactory`, `ProfileRegistry`, `GithubReputationRegistry`, `TimelockController`, and `JudgeDAO`.
   - Addresses are automatically saved to `./deployments/polygon_addresses.json`.

5. **Update App Configuration**
   - Addresses are automatically synced to `frontend/src/config/polygon_addresses.json`.

6. **Configure Bootstrap Roles & Multi-Sig Safe**
   - Create a Gnosis Safe on Polygon Mainnet at [safe.global](https://safe.global).
   - Update `JUDGE_1_ADDRESS`, `JUDGE_2_ADDRESS`, and `TREASURY_SAFE_ADDRESS` in `.env`.
   - Run the bootstrap setup:
     ```bash
     npx hardhat run scripts/bootstrap.ts --network polygon
     ```

7. **Verify Roles**
   - Confirm all role checks in the bootstrap output show `✓` before continuing.

8. **Filebase IPFS Setup**
   - Register at [filebase.com](https://filebase.com), get your IPFS API credentials, and set `FILEBASE_API_KEY` in `.env`.

9. **AuditX SIEM Security Monitoring**
   - Register PolyLance as an AuditX client app to receive real-time webhook security alerts.
   - Configure `AUDITX_API_KEY` and `AUDITX_WEBHOOK_SECRET` in `.env`.

10. **Upstash Redis Rate Limiting**
    - Create a serverless Redis database at [upstash.com](https://upstash.com).
    - Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env`.

11. **Run Development Server & Tests**
    ```bash
    npm run dev
    npx hardhat test
    ```

---

## 🧪 Verification Commands

```bash
# Run full contract & integration test suite (113 passing tests)
npx hardhat test

# Run reentrancy exploit test explicitly
npx hardhat test test/ReentrancyGuard.test.js

# Verify environment variable safety (ensure no real secrets are leaked in .env.example)
grep -E "0x[a-fA-F0-9]{40}|ax_live_|sec_[a-f0-9]{32}" .env.example
```
