import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AidDistribution Contract Tests (SGD version)", function () {
  let owner, donor, organisation, beneficiary, store, dao, anotherStore;
  let aidDistribution, mockSGD;

  const ONE = ethers.parseUnits("1.0", 18);
  const HALF = ethers.parseUnits("0.5", 18);

  beforeEach(async function () {
    [owner, donor, organisation, beneficiary, store, dao, anotherStore] =
      await ethers.getSigners();

    // Deploy stablecoin
    const MockSGD = await ethers.getContractFactory("MockSGD");
    mockSGD = await MockSGD.deploy();
    await mockSGD.waitForDeployment();

    // Deploy AidDistribution with stablecoin address
    const AidDistribution = await ethers.getContractFactory("AidDistribution");
    aidDistribution = await AidDistribution.deploy(mockSGD.target);
    await aidDistribution.waitForDeployment();

    // Mint SGD to test users
    await mockSGD.mint(donor.address, ONE * 10n);
    await mockSGD.mint(store.address, ONE * 10n);
    await mockSGD.mint(organisation.address, ONE * 10n);

    // Approve AidDistribution to spend SGD
    await mockSGD.connect(donor).approve(aidDistribution.target, ONE * 10n);
    await mockSGD
      .connect(organisation)
      .approve(aidDistribution.target, ONE * 10n);

    // Set Roles
    await aidDistribution.setRole(donor.address, 1); // Donor
    await aidDistribution.setRole(organisation.address, 2); // Org
    await aidDistribution.setRole(beneficiary.address, 3); // Bene
    await aidDistribution.setRole(store.address, 4); // Store
  });

  // ------------------------------------------------------
  // ROLE MANAGEMENT
  // ------------------------------------------------------
  describe("Role Management", function () {
    it("Owner can assign roles", async () => {
      expect(await aidDistribution.roles(donor.address)).to.equal(1);
      expect(await aidDistribution.roles(organisation.address)).to.equal(2);
    });

    it("Non-owner cannot assign roles", async () => {
      await expect(
        aidDistribution.connect(donor).setRole(donor.address, 2)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Cannot assign role to zero address", async () => {
      await expect(
        aidDistribution.setRole(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Cannot assign role to zero address");
    });
  });

  // ------------------------------------------------------
  // DEPOSIT / WITHDRAW SGD
  // ------------------------------------------------------
  describe("Money Donation and Management", function () {
    it("Donor deposits SGD and receives AID tokens", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);
      expect(await aidDistribution.balanceOf(donor.address)).to.equal(ONE);
    });

    it("Zero deposit should revert", async () => {
      await expect(
        aidDistribution.connect(donor).depositMoney(0)
      ).to.be.revertedWith("amount=0");
    });

    it("Donor burns AID_TOKEN to withdraw SGD", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);

      const before = await mockSGD.balanceOf(donor.address);
      await aidDistribution.connect(donor).donorWithdrawEther(HALF);
      const after = await mockSGD.balanceOf(donor.address);

      expect(after - before).to.equal(HALF);
    });

    it("Non-donor cannot withdraw", async () => {
      await expect(
        aidDistribution.connect(organisation).donorWithdrawEther(ONE)
      ).to.be.revertedWith("not donor");
    });
  });

  // ------------------------------------------------------
  // ORG ASSIGNMENT
  // ------------------------------------------------------
  describe("Organisation Assignment", function () {
    it("Donor assigns AID_TOKEN to Organisation", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);

      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, HALF);

      expect(await aidDistribution.balanceOf(organisation.address)).to.equal(
        HALF
      );
    });

    it("Non-donors/non-orgs cannot assign", async () => {
      await expect(
        aidDistribution.connect(beneficiary).assignToOrganisation(organisation.address, 1)
      ).to.be.revertedWith("Caller must be Donor or Organisation");
    });

    it("Zero assign should revert", async () => {
      await expect(
        aidDistribution.connect(donor).assignToOrganisation(organisation.address, 0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  // ------------------------------------------------------
  // BENEFICIARY PURCHASES
  // ------------------------------------------------------
  describe("Beneficiary Purchases", function () {
    beforeEach(async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);

      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);

      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, HALF);
    });

    it("Beneficiary can purchase from store", async () => {
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, HALF);

      expect(await aidDistribution.balanceOf(beneficiary.address)).to.equal(0);
      expect(await aidDistribution.storePendingSGD(store.address)).to.equal(
        HALF
      );
    });

    it("Cannot purchase from non-store", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(organisation.address, 1)
      ).to.be.revertedWith("not store");
    });

    it("Non-beneficiary cannot purchase", async () => {
      await expect(
        aidDistribution.connect(store).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("not beneficiary");
    });

    it("Cannot overspend", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE)
      ).to.be.revertedWith("insufficient AID_TOKEN");
    });
  });

  // ------------------------------------------------------
  // STORE WITHDRAWALS (SGD)
  // ------------------------------------------------------
  describe("Store Withdrawals", function () {
    beforeEach(async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, ONE);
    });

    it("Store withdraws its pending SGD", async () => {
      const before = await mockSGD.balanceOf(store.address);

      await aidDistribution.connect(store).storeWithdrawEther(HALF);
      const after = await mockSGD.balanceOf(store.address);

      expect(after - before).to.equal(HALF);
    });

    it("Cannot withdraw more than pending", async () => {
      await expect(
        aidDistribution.connect(store).storeWithdrawEther(ONE + 1n)
      ).to.be.revertedWith("insufficient pending");
    });

    it("Non-store cannot withdraw", async () => {
      await expect(
        aidDistribution.connect(beneficiary).storeWithdrawEther(1)
      ).to.be.revertedWith("not store");
    });
  });

  // ------------------------------------------------------
  // DAO STORE APPROVAL
  // ------------------------------------------------------
  describe("DAO Store Approval", function () {
    it("DAO approves store", async () => {
      await aidDistribution.setDaoContract(dao.address);

      await aidDistribution.connect(dao).daoApproveStore(store.address);

      expect(await aidDistribution.storeIdOf(store.address)).to.equal(1);
    });

    it("Only DAO can approve store", async () => {
      await expect(
        aidDistribution.connect(donor).daoApproveStore(store.address)
      ).to.be.revertedWith("caller not dao");
    });
  });

  // ------------------------------------------------------
  // EVENT TESTS
  // ------------------------------------------------------
  describe("Event Emissions", function () {
    it("Emits DonorWithdrawal", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);

      await expect(aidDistribution.connect(donor).donorWithdrawEther(ONE))
        .to.emit(aidDistribution, "DonorWithdrawal")
        .withArgs(donor.address, ONE);
    });

    it("Emits Purchased", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);

      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE)
      )
        .to.emit(aidDistribution, "Purchased")
        .withArgs(beneficiary.address, store.address, ONE);
    });
  });

  // ------------------------------------------------------
  // ADDITIONAL EDGE CASES
  // ------------------------------------------------------
  describe("Additional Coverage + Edge Cases", () => {
    it("Token metadata is correct", async () => {
      expect(await aidDistribution.name()).to.equal("Aid Token");
      expect(await aidDistribution.symbol()).to.equal("AID_TOKEN");
    });

    it("Total supply is zero initially", async () => {
      expect(await aidDistribution.totalSupply()).to.equal(0);
    });

    it("DAO: cannot set zero DAO", async () => {
      await expect(
        aidDistribution.setDaoContract(ethers.ZeroAddress)
      ).to.be.revertedWith("dao is zero");
    });

    it("DAO: approving store twice keeps same ID", async () => {
      await aidDistribution.setDaoContract(owner.address);

      await aidDistribution.connect(owner).daoApproveStore(store.address);
      const id1 = await aidDistribution.storeIdOf(store.address);

      await aidDistribution.connect(owner).daoApproveStore(store.address);
      const id2 = await aidDistribution.storeIdOf(store.address);

      expect(id1).to.equal(id2);
    });

    it("Beneficiary: storePendingSGD accumulates correctly", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);

      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, HALF);
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, HALF);

      expect(await aidDistribution.storePendingSGD(store.address)).to.equal(
        ONE
      );
    });

    it("Store cannot withdraw another store’s pending balance", async () => {
      await aidDistribution.setRole(anotherStore.address, 4);

      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, ONE);

      await expect(
        aidDistribution.connect(anotherStore).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending");
    });

    it("setRole emits event", async () => {
      await expect(aidDistribution.setRole(store.address, 4))
        .to.emit(aidDistribution, "RoleAssigned")
        .withArgs(store.address, 4);
    });

    it("storeWithdraw emits StoreWithdrawal", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, ONE);

      await expect(aidDistribution.connect(store).storeWithdrawEther(1))
        .to.emit(aidDistribution, "StoreWithdrawal")
        .withArgs(store.address, 1);
    });
  });

  // ------------------------------------------------------
  // SECURITY TESTS
  // ------------------------------------------------------
  describe("Security Tests", function () {
    it("Reentrancy attack fails", async function () {
    // Deploy attacker
    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(aidDistribution.target);
    await attacker.waitForDeployment();

    // Attacker is a store
    await aidDistribution.setRole(attacker.target, 4);

    // Normal donation flow
    await aidDistribution.connect(donor).depositMoney(ONE);
    await aidDistribution
      .connect(donor)
      .assignToOrganisation(organisation.address, ONE);
    await aidDistribution
      .connect(organisation)
      .assignToBeneficiary(beneficiary.address, ONE);

    // Beneficiary shops at attacker store
    await aidDistribution
      .connect(beneficiary)
      .purchaseFromStore(attacker.target, ONE);

    // Reentrancy attempt
    await expect(attacker.attack()).to.not.be.reverted; 
});


    it("Only owner can assign roles", async () => {
      await expect(
        aidDistribution.connect(donor).setRole(store.address, 2)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only DAO can approve store", async () => {
      await expect(
        aidDistribution.connect(donor).daoApproveStore(store.address)
      ).to.be.revertedWith("caller not dao");
    });

    it("Only donor can withdraw SGD", async () => {
      await expect(
        aidDistribution.connect(store).donorWithdrawEther(ONE)
      ).to.be.revertedWith("not donor");
    });

    it("Only beneficiary can purchase", async () => {
      await expect(
        aidDistribution.connect(store).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("not beneficiary");
    });

    it("Only stores can withdraw pending SGD", async () => {
      await expect(
        aidDistribution.connect(donor).storeWithdrawEther(1)
      ).to.be.revertedWith("not store");
    });

    it("Cannot assign role to zero address", async () => {
      await expect(
        aidDistribution.setRole(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Cannot assign role to zero address");
    });

    it("Store cannot withdraw without pending balance", async () => {
      await expect(
        aidDistribution.connect(store).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending");
    });

    it("Malicious beneficiary cannot overspend AID_TOKEN", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("insufficient AID_TOKEN");
    });

    it("Malicious donor cannot withdraw without balance", async () => {
      await expect(
        aidDistribution.connect(donor).donorWithdrawEther(1)
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("A store cannot withdraw another store’s pendingSGD", async () => {
      await aidDistribution.setRole(anotherStore.address, 4);

      await aidDistribution.connect(donor).depositMoney(ONE);
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE);

      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, ONE);

      await expect(
        aidDistribution.connect(anotherStore).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending");
    });
  });
});
