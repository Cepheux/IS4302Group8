// scripts/deploy.cjs
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy MockSGD
  console.log("\n1. Deploying MockSGD...");
  const MockSGD = await hre.ethers.getContractFactory("MockSGD");
  const mockSGD = await MockSGD.deploy();
  await mockSGD.waitForDeployment();
  const mockSGDAddress = await mockSGD.getAddress();
  console.log("MockSGD deployed to:", mockSGDAddress);

  // 2. Deploy AidDistribution
  console.log("\n2. Deploying AidDistribution...");
  const AidDistribution = await hre.ethers.getContractFactory("AidDistribution");
  const aidDistribution = await AidDistribution.deploy(mockSGDAddress);
  await aidDistribution.waitForDeployment();
  const aidAddress = await aidDistribution.getAddress();
  console.log("AidDistribution deployed to:", aidAddress);

  // 3. Deploy GovernanceToken
  console.log("\n3. Deploying GovernanceToken...");
  const GovernanceToken = await hre.ethers.getContractFactory("GovernanceToken");
  const governanceToken = await GovernanceToken.deploy();
  await governanceToken.waitForDeployment();
  const govTokenAddress = await governanceToken.getAddress();
  console.log("GovernanceToken deployed to:", govTokenAddress);

  // 4. Deploy StoreDao
  console.log("\n4. Deploying StoreDao...");
  const StoreDao = await hre.ethers.getContractFactory("StoreDao");
  const storeDao = await StoreDao.deploy(govTokenAddress, aidAddress);
  await storeDao.waitForDeployment();
  const daoDddress = await storeDao.getAddress();
  console.log("StoreDao deployed to:", daoDddress);

  // 5. Set DAO contract in AidDistribution
  console.log("\n5. Setting DAO contract in AidDistribution...");
  const tx = await aidDistribution.setDaoContract(daoDddress);
  await tx.wait();
  console.log("DAO contract set successfully");

  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("MockSGD:", mockSGDAddress);
  console.log("AidDistribution:", aidAddress);
  console.log("GovernanceToken:", govTokenAddress);
  console.log("StoreDao:", daoDddress);
  console.log("Deployer:", deployer.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });