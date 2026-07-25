const { ethers } = require("ethers");

/**
 * oracle/githubScorer.js
 * Calculates star-weighted developer score and signs attestation payload.
 */

function calculateDeveloperScore(repos) {
  let primaryScore = 0;
  const secondaryScores = {};

  for (const repo of repos) {
    const stars = repo.stargazers_count || 0;
    const lang = repo.language || "Other";
    const points = 50 + stars * 10;

    if (lang === "Solidity" || lang === "TypeScript" || lang === "JavaScript") {
      primaryScore += points;
    } else {
      secondaryScores[lang] = (secondaryScores[lang] || 0) + points;
    }
  }

  const primaryCategory = ethers.id("Web3/Fullstack");
  const secondaryCategories = Object.keys(secondaryScores).map((lang) => ethers.id(lang));
  const secondaryScoresArray = Object.values(secondaryScores);

  return {
    primaryCategory,
    primaryScore,
    secondaryCategories,
    secondaryScores: secondaryScoresArray,
  };
}

async function createSignedAttestation(oracleWallet, userAddress, scoreData, chainId, registryAddress) {
  const attestationUID = ethers.keccak256(
    ethers.toUtf8Bytes(`attestation-${userAddress}-${Date.now()}`)
  );

  const messageHash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "bytes32", "uint256", "bytes32[]", "uint256[]", "bytes32"],
    [
      chainId,
      registryAddress,
      userAddress,
      scoreData.primaryCategory,
      scoreData.primaryScore,
      scoreData.secondaryCategories,
      scoreData.secondaryScores,
      attestationUID,
    ]
  );

  const signature = await oracleWallet.signMessage(ethers.getBytes(messageHash));

  return {
    primaryCategory: scoreData.primaryCategory,
    primaryScore: scoreData.primaryScore,
    secondaryCategories: scoreData.secondaryCategories,
    secondaryScores: scoreData.secondaryScores,
    attestationUID,
    signature,
  };
}

module.exports = {
  calculateDeveloperScore,
  createSignedAttestation,
};
