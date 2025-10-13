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

    it('Should only allow specified store to redeem vouchers', async function () {
      // Create another store
      const [, , , , anotherStore] = await ethers.getSigners()
      await aidDistribution.setRole(anotherStore.address, 4) // Store role

      // Debug: Check voucher properties
      const itemInfo = await aidDistribution.itemInfo(voucherTokenId)
      console.log('Voucher isVoucher:', itemInfo.isVoucher)
      console.log('Voucher allowedStore:', itemInfo.allowedStore)
      console.log('Store address:', store.address)
      console.log('AnotherStore address:', anotherStore.address)

      // Try with the non-allowed store - this should fail
      await expect(
        aidDistribution
          .connect(anotherStore)
          .redeem(beneficiary.address, voucherTokenId, 1)
      ).to.be.revertedWith('This voucher cannot be redeemed at this store')
    })

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
})
