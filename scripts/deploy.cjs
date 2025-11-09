// scripts/deploy.cjs
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer, org1, org2, storeCandidate] = await ethers.getSigners();

  // 1. AidDistribution
  const AidDistribution = await ethers.getContractFactory("AidDistribution");
  const aid = await AidDistribution.deploy("https://example.com/{id}.json");
  await aid.waitForDeployment();
  const aidAddress = await aid.getAddress();

  // 2. GovernanceToken
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const gov = await GovernanceToken.deploy();
  await gov.waitForDeployment();
  const govAddress = await gov.getAddress();

  // 3. StoreDao(governanceToken, aid)
  const StoreDao = await ethers.getContractFactory("StoreDao");
  const dao = await StoreDao.deploy(govAddress, aidAddress);
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();

  // 4. Wire DAO into AidDistribution
  await (await aid.setDaoContract(daoAddress)).wait();

  // 5. Mint governance tokens to orgs
  await (await gov.mint(org1.address, ethers.parseEther("1"))).wait();
  await (await gov.mint(org2.address, ethers.parseEther("1"))).wait();

  // 6. Mark orgs as Organisations (StakeholderType = 2)
  await (await aid.setRole(org1.address, 2)).wait();
  await (await aid.setRole(org2.address, 2)).wait();

  console.log("Deployer        :", deployer.address);
  console.log("Org1            :", org1.address);
  console.log("Org2            :", org2.address);
  console.log("Store candidate :", storeCandidate.address);
  console.log("AidDistribution :", aidAddress);
  console.log("GovernanceToken :", govAddress);
  console.log("StoreDao        :", daoAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
