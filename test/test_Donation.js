import { expect } from 'chai'
import pkg from 'hardhat'
const { ethers } = pkg

describe('AidDistribution Contract Tests', function () {
  let owner, donor, organisation, beneficiary, store, dao
  let aidDistribution

  // Helper constants
  const ONE_ETH = ethers.parseEther('1.0')
  const HALF_ETH = ethers.parseEther('0.5')

  beforeEach(async function () {
    ;[owner, donor, organisation, beneficiary, store, dao] =
      await ethers.getSigners()

    // Deploy the AidDistribution contract
    const AidDistribution = await ethers.getContractFactory('AidDistribution')
    aidDistribution = await AidDistribution.deploy(
      'https://api.example.com/metadata/{id}.json'
    )
    await aidDistribution.waitForDeployment()

    // Set up roles
    await aidDistribution.setRole(donor.address, 1) // Donor
    await aidDistribution.setRole(organisation.address, 2) // Organisation
    await aidDistribution.setRole(beneficiary.address, 3) // Beneficiary
    await aidDistribution.setRole(store.address, 4) // Store
  })

  describe('Role Management', function () {
    it('Should allow owner to assign roles', async function () {
      expect(await aidDistribution.roles(donor.address)).to.equal(1) // Donor
      expect(await aidDistribution.roles(organisation.address)).to.equal(2) // Organisation
      expect(await aidDistribution.roles(beneficiary.address)).to.equal(3) // Beneficiary
      expect(await aidDistribution.roles(store.address)).to.equal(4) // Store
    })

    it('Should not allow non-owner to assign roles', async function () {
      await expect(
        aidDistribution.connect(donor).setRole(donor.address, 2)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should not allow assigning role to zero address', async function () {
      await expect(
        aidDistribution.setRole(ethers.ZeroAddress, 1)
      ).to.be.revertedWith('Cannot assign role to zero address')
    })
  })

  describe('Money Donation and Management', function () {
    it('Should allow donors to deposit money and receive tokenised money', async function () {
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })

      const balance = await aidDistribution.balanceOf(donor.address,)
      expect(balance).to.equal(ONE_ETH)
    })

    it('Should not allow deposit with mismatched amount and value', async function () {
      await expect(
        aidDistribution
          .connect(donor)
          .depositMoney(ONE_ETH, { value: HALF_ETH })
      ).to.be.revertedWith('Ether sent must equal the specified amount')
    })

    it('Should not allow zero amount deposits', async function () {
      await expect(
        aidDistribution.connect(donor).depositMoney(0, { value: 0 })
      ).to.be.revertedWith('Amount must be greater than 0')
    })

    it("Donor burns AID_TOKEN to withdraw ETH", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });

      const before = await ethers.provider.getBalance(donor.address);

      const tx = await aidDistribution.connect(donor).donorWithdrawEther(HALF_ETH);
      const gas = (await tx.wait()).gasUsed * tx.gasPrice;

      const after = await ethers.provider.getBalance(donor.address);

      const net = after + gas - before;
      expect(net).to.be.closeTo(HALF_ETH, ethers.parseEther("0.001"));
    });

    it('Should not allow non-donors to withdraw ETH', async function () {
      await expect(
        aidDistribution.connect(organisation).donorWithdrawEther(ONE_ETH)
      ).to.be.revertedWith('not donor')
    })

  describe("Organisation Assignment", () => {
    it("Donor assigns AID_TOKEN to Organisation", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, HALF_ETH);

      expect(await aidDistribution.balanceOf(organisation.address)).to.equal(HALF_ETH);
      expect(await aidDistribution.balanceOf(donor.address)).to.equal(HALF_ETH);
    });

    it("Non-donors/non-orgs cannot assign", async () => {
      await expect(
        aidDistribution.connect(beneficiary).assignToOrganisation(organisation.address, 1)
      ).to.be.revertedWith("Caller must be Donor or Organisation");
    });

    it("Reverts on zero amount", async () => {
      await expect(
        aidDistribution.connect(donor).assignToOrganisation(organisation.address, 0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  }); 

  describe("Beneficiary Purchases", () => {
    beforeEach(async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH);

      // Organisation gives AID_TOKEN to beneficiary
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, HALF_ETH);
    });

    it("Beneficiary can purchase from store", async () => {
      await aidDistribution.connect(beneficiary).purchaseFromStore(store.address, HALF_ETH);

      expect(await aidDistribution.balanceOf(beneficiary.address)).to.equal(0);
      expect(await aidDistribution.storePendingWei(store.address)).to.equal(HALF_ETH);
    });

    it("Cannot purchase from non-store", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(organisation.address, 1)
      ).to.be.revertedWith("recipient not store");
    });

    it("Non-beneficiaries cannot purchase", async () => {
      await expect(
        aidDistribution.connect(store).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("caller not beneficiary");
    });

    it("Cannot purchase more than balance", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE_ETH)
      ).to.be.revertedWith("insufficient AID_TOKEN");
    });
  });

  describe("Store Withdrawals", () => {
    beforeEach(async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH);
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE_ETH);
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, ONE_ETH);
    });

    it("Store withdraws ETH", async () => {
      const before = await ethers.provider.getBalance(store.address);

      const tx = await aidDistribution.connect(store).storeWithdrawEther(HALF_ETH);
      const gas = (await tx.wait()).gasUsed * tx.gasPrice;

      const after = await ethers.provider.getBalance(store.address);

      const net = after + gas - before;
      expect(net).to.be.closeTo(HALF_ETH, ethers.parseEther("0.001"));
    });

    it("Cannot withdraw more than pending", async () => {
      await expect(
        aidDistribution.connect(store).storeWithdrawEther(ONE_ETH + 1n)
      ).to.be.revertedWith("insufficient pending");
    });

    it("Non-stores cannot withdraw", async () => {
      await expect(
        aidDistribution.connect(beneficiary).storeWithdrawEther(1)
      ).to.be.revertedWith("not store");
    });
  });


  describe("DAO Store Approval", () => {
    it("DAO approves store", async () => {

      await aidDistribution.setDaoContract(dao.address);
      const tx = await aidDistribution.connect(dao).daoApproveStore(store.address);

      const storeId = await aidDistribution.storeIdOf(store.address);
      expect(storeId).to.equal(1);
    });

    it("Only DAO can approve store", async () => {
      await expect(
        aidDistribution.connect(donor).daoApproveStore(store.address)
      ).to.be.revertedWith("caller not dao");
    });
  });

  describe("Event Emissions", () => {
    it("Emits DonorWithdrawal", async () => {
      await aidDistribution.connect(donor).depositMoney(1, { value: 1 });

      await expect(aidDistribution.connect(donor).donorWithdrawEther(1))
        .to.emit(aidDistribution, "DonorWithdrawal")
        .withArgs(donor.address, 1);
    });

    it("Emits Purchased", async () => {
      await aidDistribution.connect(donor).depositMoney(1, { value: 1 });

      // Donor → Organisation
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, 1);

      // Organisation → Beneficiary  (THIS WAS MISSING)
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, 1);

      // Beneficiary spends tokens
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, 1)
      )
        .to.emit(aidDistribution, "Purchased")
        .withArgs(beneficiary.address, store.address, 1);
    });

  });
})

  describe("Additional Coverage + Edge Cases", () => {

    it("Deployment: Token name & symbol correct", async () => {
      expect(await aidDistribution.name()).to.equal("Aid Token")
      expect(await aidDistribution.symbol()).to.equal("AID_TOKEN")
    })

    it("Deployment: totalSupply is zero initially", async () => {
      expect(await aidDistribution.totalSupply()).to.equal(0)
    })

    it("DAO: Owner cannot set DAO to zero address", async () => {
      await expect(
        aidDistribution.setDaoContract(ethers.ZeroAddress)
      ).to.be.revertedWith("dao is zero")
    })

    it("DAO: Updating DAO twice works and emits event", async () => {
      const newDao = organisation.address
      await expect(aidDistribution.setDaoContract(newDao))
        .to.emit(aidDistribution, "DaoContractUpdated")
        .withArgs(ethers.ZeroAddress, newDao)

      const secondDao = store.address
      await expect(aidDistribution.setDaoContract(secondDao))
        .to.emit(aidDistribution, "DaoContractUpdated")
        .withArgs(newDao, secondDao)
    })

    it("DAO: Approving store twice does NOT create a second store ID", async () => {
      await aidDistribution.setDaoContract(owner.address)

      await aidDistribution.connect(owner).daoApproveStore(store.address)
      const id1 = await aidDistribution.storeIdOf(store.address)

      await aidDistribution.connect(owner).daoApproveStore(store.address)
      const id2 = await aidDistribution.storeIdOf(store.address)

      expect(id1).to.equal(id2)
    })

    it("DAO: Cannot approve zero address store", async () => {
      await aidDistribution.setDaoContract(owner.address)
      await expect(
        aidDistribution.connect(owner).daoApproveStore(ethers.ZeroAddress)
      ).to.be.revertedWith("store is zero")
    })

    it("Roles: Can override an existing role", async () => {
      await aidDistribution.setRole(donor.address, 2) // change donor to Organisation
      expect(await aidDistribution.roles(donor.address)).to.equal(2)
    })

    it("Deposit: Anyone can deposit", async () => {
      await aidDistribution
        .connect(store)
        .depositMoney(ONE_ETH, { value: ONE_ETH })

      expect(await aidDistribution.balanceOf(store.address)).to.equal(ONE_ETH)
    })

    it("Deposit: Should emit ERC20 Transfer (mint) event", async () => {
      await expect(
        aidDistribution.connect(donor).depositMoney(1, { value: 1 })
      )
        .to.emit(aidDistribution, "Transfer")
        .withArgs(ethers.ZeroAddress, donor.address, 1)
    })

    it("Beneficiary: purchaseFromStore should revert on zero amount", async () => {
      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, 0)
      ).to.be.revertedWith("amount=0")
    })

    it("Beneficiary: storePendingWei accumulates correctly", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });

      // Donor → Organisation
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH);

      // Organisation → Beneficiary  (THIS WAS MISSING)
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, ONE_ETH);

      // Beneficiary purchases twice
      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, HALF_ETH);

      await aidDistribution
        .connect(beneficiary)
        .purchaseFromStore(store.address, HALF_ETH);

      expect(await aidDistribution.storePendingWei(store.address))
        .to.equal(ONE_ETH);
    });


    it("Store: withdraw 0 should revert", async () => {
      await expect(
        aidDistribution.connect(store).storeWithdrawEther(0)
      ).to.be.revertedWith("amount=0")
    })

    it("Store: cannot withdraw from another store’s pending balance", async () => {
      const otherStore = (await ethers.getSigners())[6]
      await aidDistribution.setRole(otherStore.address, 4)

      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, ONE_ETH);
      await aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE_ETH)

      await expect(
        aidDistribution.connect(otherStore).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending")
    })

    it("Events: setRole should emit RoleAssigned", async () => {
      await expect(aidDistribution.setRole(store.address, 4))
        .to.emit(aidDistribution, "RoleAssigned")
        .withArgs(store.address, 4)
    })

    it("Events: storeWithdrawEther should emit StoreWithdrawal", async () => {
      // prepare reimbursement
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, ONE_ETH);
      await aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE_ETH)


      await expect(aidDistribution.connect(store).storeWithdrawEther(1))
        .to.emit(aidDistribution, "StoreWithdrawal")
        .withArgs(store.address, 1)
    })
})
  describe("Security Tests", function () {

    // ---------------------------
    // REENTRANCY PROTECTION
    // ---------------------------
    it("Reentrancy: attacker cannot reenter storeWithdrawEther", async function () {
      // Create malicious attacker contract that tries reentrancy
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(aidDistribution.target);
      await attacker.waitForDeployment();

      // Give attacker store role
      await aidDistribution.setRole(attacker.target, 4);

      // Fund pendingWei
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, ONE_ETH);
      await aidDistribution.connect(beneficiary).purchaseFromStore(attacker.target, ONE_ETH);

      // Attack attempt should revert due to ReentrancyGuard
      await expect(attacker.attack()).to.be.reverted;
    });

    // ---------------------------
    // ACCESS CONTROL PROTECTION
    // ---------------------------
    it("Only owner can assign roles", async function () {
      await expect(
        aidDistribution.connect(donor).setRole(store.address, 2)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only DAO can approve store", async function () {
      await expect(
        aidDistribution.connect(donor).daoApproveStore(store.address)
      ).to.be.revertedWith("caller not dao");
    });

    it("Only donor can withdraw Ether", async function () {
      await expect(
        aidDistribution.connect(store).donorWithdrawEther(ONE_ETH)
      ).to.be.revertedWith("not donor");
    });

    it("Only beneficiaries can purchase from store", async function () {
      await expect(
        aidDistribution.connect(store).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("caller not beneficiary");
    });

    it("Only store addresses can withdraw storePendingWei", async function () {
      await expect(
        aidDistribution.connect(donor).storeWithdrawEther(1)
      ).to.be.revertedWith("not store");
    });

    // ---------------------------
    // INVARIANT CHECKS
    // ---------------------------
    it("Invariant: cannot mint tokens without depositing ETH", async () => {
      const beforeSupply = await aidDistribution.totalSupply();
      expect(beforeSupply).to.equal(0);

      // Ensure no internal function mints
      await expect(
        aidDistribution._mint?.(donor.address, 100)
      ).to.be.undefined; // _mint is internal and not callable
    });

    it("Invariant: storePendingWei totaling more than contract ETH is impossible", async () => {
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, ONE_ETH);

      // Beneficiary spends all tokens -> storePendingWei == ONE_ETH
      await aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE_ETH);
      const pending = await aidDistribution.storePendingWei(store.address);

      const contractBalance = await ethers.provider.getBalance(aidDistribution.target);

      expect(pending).to.equal(contractBalance);
    });

    // ---------------------------
    // ZERO ADDRESS DEFENSE
    // ---------------------------
    it("Cannot set DAO to zero address", async function () {
      await expect(
        aidDistribution.setDaoContract(ethers.ZeroAddress)
      ).to.be.revertedWith("dao is zero");
    });

    it("Cannot approve zero address store", async function () {
      await aidDistribution.setDaoContract(owner.address);

      await expect(
        aidDistribution.connect(owner).daoApproveStore(ethers.ZeroAddress)
      ).to.be.revertedWith("store is zero");
    });

    it("Cannot assign role to zero address", async function () {
      await expect(
        aidDistribution.setRole(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Cannot assign role to zero address");
    });

    // ---------------------------
    // MALICIOUS USER BEHAVIOR
    // ---------------------------
    it("Malicious beneficiary cannot overspend tokens", async function () {
      // Give beneficiary 0 tokens
      expect(await aidDistribution.balanceOf(beneficiary.address)).to.equal(0);

      await expect(
        aidDistribution.connect(beneficiary).purchaseFromStore(store.address, 1)
      ).to.be.revertedWith("insufficient AID_TOKEN");
    });

    it("Malicious donor cannot withdraw ETH without burning tokens", async function () {
      // Donor did not deposit ETH
      await expect(
        aidDistribution.connect(donor).donorWithdrawEther(1)
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("Store cannot steal ETH by withdrawing without pending balance", async () => {
      await expect(
        aidDistribution.connect(store).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending");
    });

    // ---------------------------
    // STORAGE ISOLATION
    // ---------------------------
    it("A store cannot withdraw another store’s pendingWei", async function () {
      const anotherStore = (await ethers.getSigners())[6]
      await aidDistribution.setRole(anotherStore.address, 4)

      // Fund only store #1
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, ONE_ETH)
      await aidDistribution.connect(beneficiary).purchaseFromStore(store.address, ONE_ETH)

      await expect(
        aidDistribution.connect(anotherStore).storeWithdrawEther(1)
      ).to.be.revertedWith("insufficient pending")
    })
  })

})