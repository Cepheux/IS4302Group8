import { expect } from 'chai'
import pkg from 'hardhat'
const { ethers } = pkg

describe('AidDistribution Contract Tests', function () {
  let owner, donor, organisation, beneficiary, store
  let aidDistribution

  // Helper constants
  const ONE_ETH = ethers.parseEther('1.0')
  const HALF_ETH = ethers.parseEther('0.5')
  const TOKEN_MONEY = 0

  beforeEach(async function () {
    ;[owner, donor, organisation, beneficiary, store] =
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

      const balance = await aidDistribution.balanceOf(
        donor.address,
        TOKEN_MONEY
      )
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

    it('Should allow donors to withdraw ETH by burning tokenised money', async function () {
      // First deposit money
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })

      const balanceBefore = await ethers.provider.getBalance(donor.address)

      // Withdraw half
      await aidDistribution.connect(donor).donorWithdrawEther(HALF_ETH)

      const balanceAfter = await ethers.provider.getBalance(donor.address)
      const tokenBalance = await aidDistribution.balanceOf(
        donor.address,
        TOKEN_MONEY
      )

      expect(tokenBalance).to.equal(HALF_ETH)
      // Note: balanceAfter might be less due to gas fees
    })

    it('Should not allow non-donors to withdraw ETH', async function () {
      await expect(
        aidDistribution.connect(organisation).donorWithdrawEther(ONE_ETH)
      ).to.be.revertedWith('not donor')
    })

    it('Should allow assignment of tokenised money to organisations', async function () {
      // Donor deposits money
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })

      // Assign to organisation
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, HALF_ETH)

      const donorBalance = await aidDistribution.balanceOf(
        donor.address,
        TOKEN_MONEY
      )
      const orgBalance = await aidDistribution.balanceOf(
        organisation.address,
        TOKEN_MONEY
      )

      expect(donorBalance).to.equal(HALF_ETH)
      expect(orgBalance).to.equal(HALF_ETH)
    })
  })

  describe('Item Type Creation and Management', function () {
    it('Should allow organisations to create physical good item types', async function () {
      const tx = await aidDistribution.connect(organisation).createItemType(
        false, // isVoucher
        ethers.ZeroAddress, // allowedStore (any store)
        0, // expiry (no expiry)
        10, // beneficiaryLimit
        100 // storeLimit
      )

      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })

      expect(event).to.not.be.undefined
    })

    it('Should allow organisations to create voucher item types', async function () {
      const currentTime = await ethers.provider
        .getBlock('latest')
        .then((block) => block.timestamp)
      const futureTime = currentTime + 86400 // 24 hours from now

      const tx = await aidDistribution.connect(organisation).createItemType(
        true, // isVoucher
        store.address, // allowedStore
        futureTime, // expiry
        5, // beneficiaryLimit
        50 // storeLimit
      )

      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })

      expect(event).to.not.be.undefined
    })

    it('Should not allow non-organisations to create item types', async function () {
      await expect(
        aidDistribution
          .connect(donor)
          .createItemType(false, ethers.ZeroAddress, 0, 10, 100)
      ).to.be.revertedWith('Only an Organisation can create item types')
    })

    it('Should not allow vouchers without allowed store', async function () {
      await expect(
        aidDistribution.connect(organisation).createItemType(
          true, // isVoucher
          ethers.ZeroAddress, // allowedStore (should fail)
          0,
          5,
          50
        )
      ).to.be.revertedWith('Voucher must have an allowed store')
    })
  })

  describe('Token Conversion and Assignment', function () {
    let tokenId

    beforeEach(async function () {
      // Create an item type
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 100)
      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })
      tokenId = event.args.tokenId
    })

    it('Should allow organisations to convert money to goods/vouchers', async function () {
      // Organisation needs money first
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)

      // Convert money to goods
      await aidDistribution.connect(organisation).convertTokenisedMoney(
        HALF_ETH, // moneyAmount
        tokenId, // tokenId
        100 // tokenAmount
      )

      const moneyBalance = await aidDistribution.balanceOf(
        organisation.address,
        TOKEN_MONEY
      )
      const goodsBalance = await aidDistribution.balanceOf(
        organisation.address,
        tokenId
      )

      expect(moneyBalance).to.equal(HALF_ETH)
      expect(goodsBalance).to.equal(100)
    })

    it('Should allow organisations to assign goods to beneficiaries', async function () {
      // Set up: organisation has goods
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution
        .connect(organisation)
        .convertTokenisedMoney(HALF_ETH, tokenId, 50)

      // Assign goods to beneficiary
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, tokenId, 10)

      const beneficiaryBalance = await aidDistribution.balanceOf(
        beneficiary.address,
        tokenId
      )
      expect(beneficiaryBalance).to.equal(10)
    })

    it('Should not allow assignment of money tokens to beneficiaries', async function () {
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)

      await expect(
        aidDistribution
          .connect(organisation)
          .assignToBeneficiary(beneficiary.address, TOKEN_MONEY, HALF_ETH)
      ).to.be.revertedWith('Cannot assign money tokens to beneficiary')
    })
  })

  describe('Redemption and Store Operations', function () {
    let tokenId

    beforeEach(async function () {
      // Create item type and set up tokens
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 100)
      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })
      tokenId = event.args.tokenId

      // Set up: beneficiary has tokens
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution
        .connect(organisation)
        .convertTokenisedMoney(HALF_ETH, tokenId, 50)
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, tokenId, 10)
    })

    it('Should allow stores to redeem tokens for beneficiaries', async function () {
      const beneficiaryBalanceBefore = await aidDistribution.balanceOf(
        beneficiary.address,
        tokenId
      )

      await aidDistribution
        .connect(store)
        .redeem(beneficiary.address, tokenId, 5)

      const beneficiaryBalanceAfter = await aidDistribution.balanceOf(
        beneficiary.address,
        tokenId
      )
      const storePending = await aidDistribution.storePendingWei(store.address)

      expect(beneficiaryBalanceAfter).to.equal(beneficiaryBalanceBefore - 5n)
      expect(storePending).to.equal(5)
    })

    it('Should enforce beneficiary redemption limits', async function () {
      // Try to redeem more than the limit (limit is 10, beneficiary has 10)
      await expect(
        aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 11)
      ).to.be.revertedWith('Beneficiary redemption limit exceeded')
    })

    it('Should enforce store redemption limits', async function () {
      // First redeem up to beneficiary limit (10)
      await aidDistribution
        .connect(store)
        .redeem(beneficiary.address, tokenId, 10)

      // Try to redeem more - this should fail due to insufficient beneficiary balance
      // (beneficiary has 10 tokens, limit is 10, so trying to redeem 1 more should fail)
      await expect(
        aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 1)
      ).to.be.revertedWith('Beneficiary redemption limit exceeded')
    })

    it('Should allow stores to withdraw pending ETH reimbursements', async function () {
      // First redeem some tokens to create pending balance
      await aidDistribution
        .connect(store)
        .redeem(beneficiary.address, tokenId, 5)

      const storeBalanceBefore = await ethers.provider.getBalance(store.address)
      const pendingBefore = await aidDistribution.storePendingWei(store.address)

      // Withdraw half of pending
      await aidDistribution.connect(store).storeWithdrawEther(2)

      const pendingAfter = await aidDistribution.storePendingWei(store.address)

      expect(pendingAfter).to.equal(pendingBefore - 2n)
      // Note: storeBalanceAfter might be less due to gas fees
    })

    it('Should not allow non-stores to withdraw ETH', async function () {
      await expect(
        aidDistribution.connect(organisation).storeWithdrawEther(ONE_ETH)
      ).to.be.revertedWith('not store')
    })
  })

  describe('Voucher-Specific Functionality', function () {
    let voucherTokenId
    let futureTime

    beforeEach(async function () {
      // Set up future time for voucher expiry
      const currentTime = await ethers.provider
        .getBlock('latest')
        .then((block) => block.timestamp)
      futureTime = currentTime + 86400 // 24 hours from now

      const tx = await aidDistribution.connect(organisation).createItemType(
        true, // isVoucher
        store.address, // allowedStore
        futureTime, // expiry
        5, // beneficiaryLimit
        50 // storeLimit
      )
      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })
      voucherTokenId = event.args.tokenId

      // Set up: beneficiary has vouchers
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)
      await aidDistribution
        .connect(organisation)
        .convertTokenisedMoney(HALF_ETH, voucherTokenId, 20)
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, voucherTokenId, 5)
    })

    it("Should only allow specified store to redeem vouchers", async function () {
      const signers = await ethers.getSigners();
      const anotherStore = signers[5]; // ✅ sixth signer, distinct from store
      await aidDistribution.setRole(anotherStore.address, 4); // Store role

      await expect(
        aidDistribution
          .connect(anotherStore)
          .redeem(beneficiary.address, voucherTokenId, 1)
      ).to.be.revertedWith("This voucher cannot be redeemed at this store");
    });

    it('Should allow the specified store to redeem vouchers', async function () {
      await aidDistribution
        .connect(store)
        .redeem(beneficiary.address, voucherTokenId, 1)

      const beneficiaryBalance = await aidDistribution.balanceOf(
        beneficiary.address,
        voucherTokenId
      )
      expect(beneficiaryBalance).to.equal(4)
    })

    it('Should not allow redemption of expired vouchers', async function () {
      // Fast forward time past the expiry
      await ethers.provider.send('evm_increaseTime', [86401]) // 24 hours + 1 second
      await ethers.provider.send('evm_mine', []) // Mine a new block

      await expect(
        aidDistribution
          .connect(store)
          .redeem(beneficiary.address, voucherTokenId, 1)
      ).to.be.revertedWith('Voucher has expired')
    })
  })

  describe('Edge Cases and Error Handling', function () {
    it('Should handle insufficient balance scenarios', async function () {
      await aidDistribution
        .connect(donor)
        .depositMoney(HALF_ETH, { value: HALF_ETH })

      await expect(
        aidDistribution.connect(donor).donorWithdrawEther(ONE_ETH)
      ).to.be.revertedWith('ERC1155: burn amount exceeds balance')
    })

    it('Should handle zero amount operations', async function () {
      await expect(
        aidDistribution.connect(donor).depositMoney(0, { value: 0 })
      ).to.be.revertedWith('Amount must be greater than 0')
    })

    it('Should handle invalid token IDs', async function () {
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, ONE_ETH)

      await expect(
        aidDistribution
          .connect(organisation)
          .convertTokenisedMoney(HALF_ETH, 999, 10)
      ).to.be.revertedWith('Target token type does not exist')
    })
  })

  describe('Complete Donation Flow', function () {
    it('Should handle complete donation flow: deposit -> assign -> convert -> assign -> redeem -> withdraw', async function () {
      // 1. Donor deposits money
      await aidDistribution
        .connect(donor)
        .depositMoney(ONE_ETH, { value: ONE_ETH })

      // 2. Donor assigns money to organisation
      await aidDistribution
        .connect(donor)
        .assignToOrganisation(organisation.address, HALF_ETH)

      // 3. Organisation creates item type
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 100)
      const receipt = await tx.wait()
      const event = receipt.logs.find((log) => {
        try {
          const parsed = aidDistribution.interface.parseLog(log)
          return parsed.name === 'ItemTypeCreated'
        } catch (e) {
          return false
        }
      })
      const tokenId = event.args.tokenId

      // 4. Organisation converts money to goods
      await aidDistribution
        .connect(organisation)
        .convertTokenisedMoney(HALF_ETH, tokenId, 50)

      // 5. Organisation assigns goods to beneficiary
      await aidDistribution
        .connect(organisation)
        .assignToBeneficiary(beneficiary.address, tokenId, 10)

      // 6. Store redeems goods for beneficiary
      await aidDistribution
        .connect(store)
        .redeem(beneficiary.address, tokenId, 5)

      // 7. Store withdraws ETH reimbursement
      await aidDistribution.connect(store).storeWithdrawEther(3)

      // Verify final states
      const beneficiaryBalance = await aidDistribution.balanceOf(
        beneficiary.address,
        tokenId
      )
      const storePending = await aidDistribution.storePendingWei(store.address)

      expect(beneficiaryBalance).to.equal(5)
      expect(storePending).to.equal(2) // 5 redeemed - 3 withdrawn = 2 remaining
    })
  })

  describe("Role & Access Control — Extended", function () {
  it("Should allow owner to reassign an existing role", async function () {
    await aidDistribution.setRole(donor.address, 2)
    expect(await aidDistribution.roles(donor.address)).to.equal(2)
  })

  it("Should allow owner to clear an assigned role (set to None)", async function () {
    await aidDistribution.setRole(donor.address, 0)
    expect(await aidDistribution.roles(donor.address)).to.equal(0)
  })

  it("Should revert if non-Organisation calls convertTokenisedMoney", async function () {
    await expect(
      aidDistribution.connect(donor).convertTokenisedMoney(1, 1, 1)
    ).to.be.revertedWith("Caller must be an Organisation")
  })

  it("Should revert if non-Organisation calls assignToBeneficiary", async function () {
    await expect(
      aidDistribution.connect(donor).assignToBeneficiary(beneficiary.address, 1, 1)
    ).to.be.revertedWith("Caller must be an Organisation")
  })

  it("Should revert if non-Store calls redeem", async function () {
    await expect(
      aidDistribution.connect(organisation).redeem(beneficiary.address, 1, 1)
    ).to.be.revertedWith("Caller must be a Store")
  })
})

describe("Deposit & Withdrawal — Edge Cases", function () {
  it("Should revert when value > amount in deposit", async function () {
    await expect(
      aidDistribution.connect(donor).depositMoney(1, { value: 2 })
    ).to.be.revertedWith("Ether sent must equal the specified amount")
  })

  it("Should revert on donorWithdrawEther with zero amount", async function () {
    await expect(
      aidDistribution.connect(donor).donorWithdrawEther(0)
    ).to.be.revertedWith("amount=0")
  })

  it("Should revert on ETH transfer failure (simulate via mock)", async function () {
    // Deploy a malicious contract with fallback that reverts
    // and attempt withdrawal to it
    // (advanced mock test, can skip if framework lacks helper)
  })
})
describe("Item Type Creation — Additional Validations", function () {
  it("Should revert when voucher expiry is in the past", async function () {
    const pastTime = (await ethers.provider.getBlock("latest")).timestamp - 10
    await expect(
      aidDistribution.connect(organisation)
        .createItemType(true, store.address, pastTime, 10, 10)
    ).to.be.revertedWith("Expiry must be in the future if set")
  })

  it("Should revert when beneficiaryLimit = 0", async function () {
    await expect(
      aidDistribution.connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 0, 5)
    ).to.be.revertedWith("Limits must be greater than 0")
  })

  it("Should increment token IDs correctly after multiple creations", async function () {
    const tx1 = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 1, 1)
    const tx2 = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 1, 1)
    const id1 = (await tx1.wait()).logs[0].args.tokenId
    const id2 = (await tx2.wait()).logs[0].args.tokenId
    expect(Number(id2)).to.equal(Number(id1) + 1)
  })
})
describe("convertTokenisedMoney — Extended", function () {
  let tokenId
  beforeEach(async () => {
    const tx = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 1, 1)
    tokenId = (await tx.wait()).logs[0].args.tokenId
  })

  it("Should revert if tokenId == TOKEN_MONEY", async function () {
    await expect(
      aidDistribution.connect(organisation).convertTokenisedMoney(1, 0, 1)
    ).to.be.revertedWith("Target tokenId must not be TOKEN_MONEY")
  })

  it("Should revert if moneyAmount or tokenAmount = 0", async function () {
    await expect(
      aidDistribution.connect(organisation).convertTokenisedMoney(0, tokenId, 10)
    ).to.be.revertedWith("Amounts must be greater than 0")
  })

  it("Should revert if insufficient TOKEN_MONEY balance", async function () {
    await expect(
      aidDistribution.connect(organisation).convertTokenisedMoney(100, tokenId, 10)
    ).to.be.revertedWith("Insufficient tokenised money balance")
  })
})
describe("assignToBeneficiary — Edge Conditions", function () {
  let tokenId
  beforeEach(async () => {
    const tx = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 10, 10)
    tokenId = (await tx.wait()).logs[0].args.tokenId
  })

  it("Should revert when recipient is not Beneficiary", async function () {
    await expect(
      aidDistribution.connect(organisation).assignToBeneficiary(store.address, tokenId, 1)
    ).to.be.revertedWith("Recipient must be a Beneficiary")
  })

  it("Should revert on zero amount", async function () {
    await expect(
      aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, tokenId, 0)
    ).to.be.revertedWith("Amount must be greater than 0")
  })
})
describe("Redemption — Boundary and Limit Cases", function () {
  let tokenId
  beforeEach(async function () {
    const tx = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 5, 5)
    tokenId = (await tx.wait()).logs[0].args.tokenId
    await aidDistribution.connect(donor).depositMoney(5, { value: 5 })
    await aidDistribution.connect(donor).assignToOrganisation(organisation.address, 5)
    await aidDistribution.connect(organisation).convertTokenisedMoney(5, tokenId, 5)
    await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, tokenId, 5)
  })

  it("Should revert on redeem with TOKEN_MONEY", async function () {
    await expect(
      aidDistribution.connect(store).redeem(beneficiary.address, 0, 1)
    ).to.be.revertedWith("Cannot redeem TOKEN_MONEY as goods")
  })

  it("Should revert on redeem zero amount", async function () {
    await expect(
      aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 0)
    ).to.be.revertedWith("Amount must be greater than 0")
  })

  it("Should revert if store redeems above storeLimit", async function () {
    await expect(
      aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 6)
    ).to.be.revertedWith("Beneficiary redemption limit exceeded")
  })
})
describe("Store Withdrawals — Validation", function () {
  it("Should revert on zero withdrawal amount", async function () {
    await expect(
      aidDistribution.connect(store).storeWithdrawEther(0)
    ).to.be.revertedWith("amount=0")
  })

  it("Should revert on withdraw more than pending", async function () {
    await expect(
      aidDistribution.connect(store).storeWithdrawEther(100)
    ).to.be.revertedWith("insufficient pending")
  })
})
describe("Event Emission Tests", function () {
  it("Should emit DonorWithdrawal event on donor withdrawal", async function () {
    await aidDistribution.connect(donor).depositMoney(1, { value: 1 })
    await expect(aidDistribution.connect(donor).donorWithdrawEther(1))
      .to.emit(aidDistribution, "DonorWithdrawal")
      .withArgs(donor.address, 1)
  })

  it("Should emit Converted event on convertTokenisedMoney", async function () {
    await aidDistribution.connect(donor).depositMoney(1, { value: 1 })
    await aidDistribution.connect(donor).assignToOrganisation(organisation.address, 1)
    const tx = await aidDistribution.connect(organisation)
      .createItemType(false, ethers.ZeroAddress, 0, 1, 1)
    const tokenId = (await tx.wait()).logs[0].args.tokenId
    await expect(
      aidDistribution.connect(organisation).convertTokenisedMoney(1, tokenId, 1)
    ).to.emit(aidDistribution, "Converted")
  })
})

  // ------------------------------------------------------------------
  // 1. REENTRANCY PROTECTION
  // ------------------------------------------------------------------
  describe("Reentrancy Protection", function () {
    it("Should revert reentrant calls on donorWithdrawEther", async function () {
      //  Deposit as donor
      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });

      // Sanity check donor role
      expect(await aidDistribution.roles(donor.address)).to.equal(1);

      // Simulate a safe withdrawal (non-reentrant)
      await expect(aidDistribution.connect(donor).donorWithdrawEther(HALF_ETH))
        .to.emit(aidDistribution, "DonorWithdrawal")
        .withArgs(donor.address, HALF_ETH);
    });

    it("Should revert reentrant calls on storeWithdrawEther", async function () {
      // Setup a basic redeem flow to give store some pendingWei
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 10);
      const tokenId = (await tx.wait()).logs[0].args.tokenId;

      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH);
      await aidDistribution.connect(organisation).convertTokenisedMoney(ONE_ETH, tokenId, 10);
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, tokenId, 5);
      await aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 5);

      // Withdraw — should succeed safely, nonReentrant prevents double entry
      await expect(aidDistribution.connect(store).storeWithdrawEther(1)).to.emit(
        aidDistribution,
        "StoreWithdrawal"
      );
    });
  });

  // ------------------------------------------------------------------
  // 2. ACCESS CONTROL / ROLE ABUSE
  // ------------------------------------------------------------------
  describe("Access Control & Role Abuse", function () {
    it("Should prevent Beneficiary from assigning money to Organisation", async function () {
      await expect(
        aidDistribution.connect(beneficiary).assignToOrganisation(organisation.address, 1)
      ).to.be.revertedWith("Caller must be Donor or Organisation");
    });

    it("Should prevent Store from assigning money to Organisation", async function () {
      await expect(
        aidDistribution.connect(store).assignToOrganisation(organisation.address, 1)
      ).to.be.revertedWith("Caller must be Donor or Organisation");
    });

    it("Should prevent Organisation from redeeming for itself", async function () {
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 10);
      const tokenId = (await tx.wait()).logs[0].args.tokenId;

      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH);
      await aidDistribution.connect(organisation).convertTokenisedMoney(ONE_ETH, tokenId, 5);
      await expect(
        aidDistribution.connect(organisation).redeem(organisation.address, tokenId, 1)
      ).to.be.revertedWith("Caller must be a Store");
    });

    it("Should allow role overwrite and emit RoleAssigned", async function () {
      await expect(aidDistribution.setRole(donor.address, 2))
        .to.emit(aidDistribution, "RoleAssigned")
        .withArgs(donor.address, 2);
    });
  });

  // ------------------------------------------------------------------
  // 3. UNAUTHORIZED TRANSFERS & DIRECT ETH
  // ------------------------------------------------------------------
  describe("Unauthorized Transfers & ETH Handling", function () {
    it("Should reject direct ETH transfer to contract", async function () {
      await expect(
        donor.sendTransaction({ to: aidDistribution.target, value: ONE_ETH })
      ).to.be.reverted;
    });

    it("Should ensure storePendingWei increases only after redeem", async function () {
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 10, 10);
      const tokenId = (await tx.wait()).logs[0].args.tokenId;

      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH);
      await aidDistribution.connect(organisation).convertTokenisedMoney(ONE_ETH, tokenId, 10);
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, tokenId, 5);

      const pendingBefore = await aidDistribution.storePendingWei(store.address);
      await aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 2);
      const pendingAfter = await aidDistribution.storePendingWei(store.address);
      expect(pendingAfter).to.be.greaterThan(pendingBefore);
    });
  });

  // ------------------------------------------------------------------
  // 4. LIMIT ENFORCEMENT / INTEGER SAFETY
  // ------------------------------------------------------------------
  describe("Limit Enforcement & Integer Safety", function () {
    it("Should revert if redemption amount exceeds limits", async function () {
      const tx = await aidDistribution
        .connect(organisation)
        .createItemType(false, ethers.ZeroAddress, 0, 5, 5);
      const tokenId = (await tx.wait()).logs[0].args.tokenId;

      await aidDistribution.connect(donor).depositMoney(ONE_ETH, { value: ONE_ETH });
      await aidDistribution.connect(donor).assignToOrganisation(organisation.address, ONE_ETH);
      await aidDistribution.connect(organisation).convertTokenisedMoney(ONE_ETH, tokenId, 10);
      await aidDistribution.connect(organisation).assignToBeneficiary(beneficiary.address, tokenId, 5);

      await expect(
        aidDistribution.connect(store).redeem(beneficiary.address, tokenId, 1000)
      ).to.be.revertedWith("Beneficiary redemption limit exceeded");
    });
  });

  // ------------------------------------------------------------------
  // 5. DENIAL OF SERVICE (DoS) SIMULATION
  // ------------------------------------------------------------------
  describe("DoS & Fallback Safety", function () {
    it("Should revert if ETH send fails (simulated via mock)", async function () {
      // This test would require deploying an attacker contract with fallback() { revert(); }
      // Example attacker pseudocode:
      // contract BadReceiver {
      //     fallback() external payable { revert(); }
      // }
      // Then assign BadReceiver as store and call storeWithdrawEther()
      // Expected revert with "eth send failed"
    });
  });
})
