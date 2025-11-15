# Complete Codebase Context Documentation
## IS4302 Group 8 - Blockchain-Based Charitable Aid Distribution System

---

## TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Contract Details](#contract-details)
   - [AidDistribution Contract](#aiddistribution-contract)
   - [GovernanceToken Contract](#governancetoken-contract)
   - [StoreDao Contract](#storedao-contract)
4. [Complete Function Reference](#complete-function-reference)
5. [State Variables & Data Structures](#state-variables--data-structures)
6. [Events Reference](#events-reference)
7. [Workflows & Use Cases](#workflows--use-cases)
8. [Security Features](#security-features)
9. [Testing Structure](#testing-structure)
10. [Deployment Process](#deployment-process)
11. [Technical Specifications](#technical-specifications)

---

## PROJECT OVERVIEW

### Purpose
This is a blockchain-based charitable aid distribution system built on Ethereum using Solidity 0.8.19 and Hardhat framework. The system tokenizes donations (money, physical goods, and vouchers) using the ERC-1155 multi-token standard and implements a DAO (Decentralized Autonomous Organization) for governance-controlled store approval.

### Key Features
- **Tokenized Donations**: ETH is converted to ERC-1155 tokens representing money, goods, and vouchers
- **Role-Based Access Control**: Four stakeholder types (Donor, Organisation, Beneficiary, Store)
- **DAO Governance**: Organizations vote on store approvals using a credibility-weighted voting system
- **Redemption Limits**: Per-beneficiary and per-store limits prevent abuse
- **Voucher System**: Time-limited vouchers with store restrictions
- **Reentrancy Protection**: All state-changing functions protected against reentrancy attacks

### Technology Stack
- **Solidity**: ^0.8.19
- **Hardhat**: ^2.26.5
- **OpenZeppelin Contracts**: ^4.9.6 (ERC1155, Ownable, ReentrancyGuard, ERC20)
- **Ethers.js**: ^6.15.0
- **Chai**: ^4.5.0 (Testing)

---

## SYSTEM ARCHITECTURE

### Contract Relationships

```
┌─────────────────────┐
│  AidDistribution    │ (Main Contract - ERC1155)
│  - Manages tokens   │
│  - Role management  │
│  - Redemption logic │
└──────────┬──────────┘
           │
           ├─────────────────┐
           │                 │
┌──────────▼──────────┐  ┌───▼──────────────┐
│   GovernanceToken   │  │    StoreDao      │
│   (ERC20)           │  │  (DAO Contract)  │
│   - Membership      │  │  - Proposals     │
│   - Voting rights   │  │  - Voting        │
└─────────────────────┘  └──────────────────┘
```

### Token Flow

```
ETH → TOKEN_MONEY (ID=0) → Item Tokens (ID=1+) → Redemption → Store Withdrawal
```

---

## CONTRACT DETAILS

## AidDistribution Contract

**File**: `contracts/AidDistribution.sol`  
**Inherits**: `ERC1155`, `Ownable`, `ReentrancyGuard`  
**Purpose**: Main contract managing tokenized donations, role assignments, and redemption logic

### Key Characteristics
- Uses ERC-1155 for multi-token support (money + various item types)
- Implements role-based access control with 5 stakeholder types
- Tracks redemption limits per beneficiary and per store
- Integrates with DAO for store approval
- All state-changing functions protected with `nonReentrant`

---

## GovernanceToken Contract

**File**: `contracts/GovernanceToken.sol`  
**Inherits**: `ERC20`, `Ownable`  
**Purpose**: Simple ERC-20 token for DAO participation

### Details
- **Name**: "Aid Governance Token"
- **Symbol**: "AGOV"
- **Purpose**: Membership token (1 token = 1 membership, not vote weight)
- **Minting**: Owner-only via `mint()` function

---

## StoreDao Contract

**File**: `contracts/IAidDistribution.sol` (contains both interface and contract)  
**Purpose**: DAO contract for organizations to vote on store approvals

### Key Features
- Credibility-weighted voting system
- 3-day voting period
- RNG-based credibility oracle (0, 50, or 100)
- Proposal execution with pass/fail logic

---

## COMPLETE FUNCTION REFERENCE

## AidDistribution Functions

### Role Management Functions

#### `setRole(address account, StakeholderType role)`
- **Access**: `onlyOwner`
- **Parameters**:
  - `account`: Address to assign role to
  - `role`: StakeholderType enum (0=None, 1=Donor, 2=Organisation, 3=Beneficiary, 4=Store)
- **Validations**:
  - `account != address(0)`
- **Effects**: Updates `roles[account]` mapping
- **Events**: `RoleAssigned(account, role)`

#### `setDaoContract(address newDao)`
- **Access**: `onlyOwner`
- **Parameters**:
  - `newDao`: Address of the DAO contract
- **Validations**:
  - `newDao != address(0)`
- **Effects**: Updates `daoContract` state variable
- **Events**: `DaoContractUpdated(previousDao, newDao)`

#### `daoApproveStore(address store)`
- **Access**: Only `daoContract` can call
- **Parameters**:
  - `store`: Address of store to approve
- **Returns**: `uint256 storeId` - Unique store identifier
- **Validations**:
  - `msg.sender == daoContract`
  - `store != address(0)`
- **Effects**:
  - Assigns Store role to address
  - Creates new store ID if doesn't exist
  - Updates `storeById` and `storeIdOf` mappings
- **Events**: 
  - `RoleAssigned(store, StakeholderType.Store)`
  - `StoreApproved(storeId, store)`

### Money Management Functions

#### `depositMoney(uint256 amount)`
- **Access**: Public (anyone can deposit)
- **Modifiers**: `payable`, `nonReentrant`
- **Parameters**:
  - `amount`: Amount of ETH to deposit (in wei)
- **Validations**:
  - `amount > 0`
  - `msg.value == amount`
- **Effects**:
  - Mints `TOKEN_MONEY` (token ID = 0) to `msg.sender`
  - Contract receives ETH
- **Token Flow**: ETH → TOKEN_MONEY tokens

#### `donorWithdrawSGD(uint256 amount)`
- **Access**: Only Donors (`roles[msg.sender] == StakeholderType.Donor`)
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `amount`: Amount of TOKEN_MONEY to burn and ETH to withdraw
- **Validations**:
  - `amount > 0`
  - Caller must be Donor
- **Effects**:
  - Burns `TOKEN_MONEY` tokens from caller
  - Sends ETH to caller
- **Events**: `DonorWithdrawal(donor, amount)`
- **Token Flow**: TOKEN_MONEY → ETH

#### `assignToOrganisation(address organisation, uint256 amount)`
- **Access**: Donor or Organisation
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `organisation`: Address of organisation to transfer to
  - `amount`: Amount of TOKEN_MONEY to transfer
- **Validations**:
  - `amount > 0`
  - Caller must be Donor or Organisation
  - Recipient must be Organisation
- **Effects**: Transfers TOKEN_MONEY using ERC1155 `safeTransferFrom`
- **Token Flow**: TOKEN_MONEY transfer between accounts

### Item Type Management

#### `createItemType(bool isVoucher, address allowedStore, uint256 expiry, uint256 beneficiaryLimit, uint256 storeLimit)`
- **Access**: Only Organisation
- **Parameters**:
  - `isVoucher`: `true` if voucher, `false` if physical good
  - `allowedStore`: Store address allowed to redeem (address(0) = any store)
  - `expiry`: Unix timestamp expiry (0 = no expiry)
  - `beneficiaryLimit`: Maximum tokens a beneficiary can redeem
  - `storeLimit`: Maximum tokens a store can redeem
- **Returns**: `uint256 tokenId` - Auto-incremented token ID
- **Validations**:
  - Caller must be Organisation
  - If `isVoucher`: `allowedStore != address(0)`
  - If `isVoucher` and `expiry != 0`: `expiry > block.timestamp`
  - `beneficiaryLimit > 0` and `storeLimit > 0`
- **Effects**:
  - Increments `_nextTokenId`
  - Creates `ItemType` struct in `itemInfo[tokenId]` mapping
- **Events**: `ItemTypeCreated(tokenId, isVoucher, allowedStore, expiry, beneficiaryLimit, storeLimit)`

### Token Conversion

#### `convertTokenisedMoney(uint256 moneyAmount, uint256 tokenId, uint256 tokenAmount)`
- **Access**: Only Organisation
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `moneyAmount`: Amount of TOKEN_MONEY to burn
  - `tokenId`: Target item token ID to mint
  - `tokenAmount`: Amount of item tokens to mint
- **Validations**:
  - Caller must be Organisation
  - `tokenId != TOKEN_MONEY` (cannot convert to money token)
  - Item type must exist (`itemInfo[tokenId]` must be set)
  - `moneyAmount > 0` and `tokenAmount > 0`
  - Caller must have sufficient TOKEN_MONEY balance
- **Effects**:
  - Burns `moneyAmount` of TOKEN_MONEY from caller
  - Mints `tokenAmount` of item tokens (tokenId) to caller
- **Events**: `Converted(organisation, moneySpent, tokenId, amountMinted)`
- **Token Flow**: TOKEN_MONEY → Item Tokens
- **Exchange Rate**: Set by organisation (moneyAmount : tokenAmount ratio)

### Beneficiary Assignment

#### `assignToBeneficiary(address beneficiary, uint256 tokenId, uint256 amount)`
- **Access**: Only Organisation
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `beneficiary`: Address of beneficiary to assign tokens to
  - `tokenId`: Item token ID to transfer
  - `amount`: Amount of tokens to transfer
- **Validations**:
  - Caller must be Organisation
  - Recipient must be Beneficiary
  - `tokenId != TOKEN_MONEY` (cannot assign money to beneficiaries)
  - Item type must exist
  - `amount > 0`
  - Caller must have sufficient token balance
- **Effects**: Transfers item tokens using ERC1155 `safeTransferFrom`
- **Events**: `Assigned(organisation, beneficiary, tokenId, amount)`
- **Token Flow**: Item Tokens from Organisation → Beneficiary

### Redemption Functions

#### `redeem(address beneficiary, uint256 tokenId, uint256 amount)`
- **Access**: Only Store
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `beneficiary`: Address of beneficiary redeeming tokens
  - `tokenId`: Item token ID to redeem
  - `amount`: Number of tokens to redeem
- **Validations**:
  - Caller must be Store
  - Target must be Beneficiary
  - `tokenId != TOKEN_MONEY` (cannot redeem money as goods)
  - Item type must exist
  - `amount > 0`
  - If voucher: `allowedStore == msg.sender` (if set)
  - If voucher: `block.timestamp <= expiry` (if expiry set)
  - New beneficiary redemption total <= `beneficiaryLimit`
  - New store redemption total <= `storeLimit`
  - Beneficiary must have sufficient token balance
- **Effects**:
  - Burns `amount` tokens from beneficiary
  - Updates `_beneficiaryRedeemed[tokenId][beneficiary]`
  - Updates `_storeRedeemed[tokenId][msg.sender]`
  - Increases `storePendingWei[msg.sender]` by `amount`
- **Events**: `Redeemed(store, beneficiary, tokenId, amount)`
- **Token Flow**: Item Tokens → Burned, `storePendingWei` increased
- **Note**: `storePendingWei` increases by token `amount` (in wei), not ETH value

#### `storeWithdrawSGD(uint256 amount)`
- **Access**: Only Store
- **Modifiers**: `nonReentrant`
- **Parameters**:
  - `amount`: Amount of ETH to withdraw (in wei)
- **Validations**:
  - Caller must be Store
  - `amount > 0`
  - `storePendingWei[msg.sender] >= amount`
- **Effects**:
  - Decreases `storePendingWei[msg.sender]` by `amount`
  - Sends ETH to store
- **Events**: `StoreWithdrawal(store, amount)`
- **Token Flow**: `storePendingWei` → ETH withdrawal

---

## GovernanceToken Functions

#### `mint(address to, uint256 amount)`
- **Access**: `onlyOwner`
- **Parameters**:
  - `to`: Address to mint tokens to
  - `amount`: Amount of tokens to mint
- **Effects**: Mints ERC20 tokens to specified address

---

## StoreDao Functions

#### `proposeStore(address store)`
- **Access**: `onlyOrganisationWithToken` (must be Organisation with governance token)
- **Parameters**:
  - `store`: Store address to propose for approval
- **Returns**: `uint256 proposalId` - Auto-incremented proposal ID
- **Validations**:
  - Caller must be Organisation
  - Caller must have governance token balance > 0
  - `store != address(0)`
- **Effects**:
  - Increments `nextProposalId`
  - Creates new `Proposal` struct with:
    - `startTime = block.timestamp`
    - `endTime = startTime + VOTING_PERIOD` (3 days)
    - All vote counts initialized to 0
- **Events**: `StoreProposalCreated(proposalId, proposer, store, startTime, endTime)`

#### `castVote(uint256 proposalId)`
- **Access**: `onlyOrganisationWithToken`
- **Parameters**:
  - `proposalId`: ID of proposal to vote on
- **Validations**:
  - Caller must be Organisation with governance token
  - Proposal must exist
  - `block.timestamp >= startTime` and `block.timestamp < endTime`
  - Caller must not have voted yet
- **Effects**:
  - Marks caller as voted (`hasVoted[proposalId][msg.sender] = true`)
  - Calls `_drawCredibility()` to get credibility score (0, 50, or 100)
  - Updates vote counts based on credibility:
    - 0 → `againstVotes++`
    - 50 → `abstainVotes++`
    - 100 → `forVotes++`
  - Increments `numVotes`
  - Adds credibility to `sumCredibility`
- **Events**: `StoreVoteCast(proposalId, voter, credibilityScore, choice)`
- **Voting Logic**: RNG-based, equal probability of 0, 50, or 100

#### `executeProposal(uint256 proposalId)`
- **Access**: `onlyOrganisationWithToken`
- **Parameters**:
  - `proposalId`: ID of proposal to execute
- **Returns**: `uint256 storeId` - Store ID if passed, 0 if failed
- **Validations**:
  - Caller must be Organisation with governance token
  - Proposal must exist
  - `block.timestamp >= endTime`
  - Proposal must not be executed yet
- **Effects**:
  - Marks proposal as executed
  - If `numVotes == 0`: Returns 0 (failed)
  - Calls `_proposalPassed()` to check if proposal passed
  - If passed: Calls `aid.daoApproveStore(store)` and returns storeId
  - If failed: Returns 0
- **Events**: `StoreProposalExecuted(proposalId, store, passed, storeId)`

#### `_proposalPassed(Proposal storage p)` (internal)
- **Purpose**: Determines if proposal meets passing criteria
- **Returns**: `bool` - `true` if passed, `false` otherwise
- **Passing Criteria**:
  1. `forVotes > againstVotes` (simple majority)
  2. `sumCredibility >= 50 * numVotes` (average credibility >= 0.5)
- **Both conditions must be true for proposal to pass**

#### `_drawCredibility(uint256 proposalId, address voter)` (internal)
- **Purpose**: RNG-based credibility oracle
- **Parameters**:
  - `proposalId`: Proposal ID (for entropy)
  - `voter`: Voter address (for entropy)
- **Returns**: `uint8` - Credibility score (0, 50, or 100)
- **Algorithm**:
  - Uses `keccak256(block.timestamp, block.prevrandao, proposalId, voter)`
  - Takes `rand % 3`:
    - 0 → Returns 0 (Against)
    - 1 → Returns 50 (Abstain)
    - 2 → Returns 100 (For)
- **Note**: Not cryptographically secure, deterministic for demo purposes

---

## STATE VARIABLES & DATA STRUCTURES

## AidDistribution State Variables

### Role Management
```solidity
enum StakeholderType { 
    None,        // 0
    Donor,        // 1
    Organisation, // 2
    Beneficiary,  // 3
    Store         // 4
}
mapping(address => StakeholderType) public roles;
```

### Token Management
```solidity
uint256 public constant TOKEN_MONEY = 0;  // Special token ID for money
uint256 private _nextTokenId = 1;         // Auto-incrementing token IDs
```

### Item Type Structure
```solidity
struct ItemType {
    bool isVoucher;              // true = voucher, false = physical good
    uint256 expiry;              // Unix timestamp (0 = no expiry)
    address allowedStore;        // Store allowed to redeem (address(0) = any)
    uint256 beneficiaryLimit;   // Max tokens beneficiary can redeem
    uint256 storeLimit;          // Max tokens store can redeem
}
mapping(uint256 => ItemType) public itemInfo;
```

### Redemption Tracking
```solidity
mapping(uint256 => mapping(address => uint256)) private _beneficiaryRedeemed;
// tokenId => beneficiary => total redeemed

mapping(uint256 => mapping(address => uint256)) private _storeRedeemed;
// tokenId => store => total redeemed

mapping(address => uint256) public storePendingWei;
// store => ETH owed (in wei)
```

### DAO Integration
```solidity
address public daoContract;                    // StoreDao contract address
uint256 private _nextStoreId = 1;              // Auto-incrementing store IDs
mapping(uint256 => address) public storeById; // storeId => store address
mapping(address => uint256) public storeIdOf;  // store address => storeId
```

## StoreDao State Variables

### Enums
```solidity
enum VoteChoice {
    Against,  // 0
    For,      // 1
    Abstain   // 2
}
```

### Proposal Structure
```solidity
struct Proposal {
    address proposer;        // Address that created proposal
    address store;           // Store address being proposed
    uint256 startTime;      // Voting start timestamp
    uint256 endTime;         // Voting end timestamp
    bool executed;           // Whether proposal has been executed
    uint256 forVotes;        // Count of "For" votes
    uint256 againstVotes;    // Count of "Against" votes
    uint256 abstainVotes;    // Count of "Abstain" votes
    uint256 numVotes;        // Total number of votes cast
    uint256 sumCredibility;  // Sum of all credibility scores
}
```

### Mappings
```solidity
mapping(uint256 => Proposal) public proposals;
// proposalId => Proposal struct

mapping(uint256 => mapping(address => bool)) public hasVoted;
// proposalId => voter => has voted
```

### Constants
```solidity
uint256 public constant VOTING_PERIOD = 3 days;
uint8 private constant ROLE_ORGANISATION = 2;
```

### Immutable References
```solidity
IERC20 public immutable governanceToken;  // GovernanceToken contract
IAidDistribution public immutable aid;     // AidDistribution contract
```

---

## EVENTS REFERENCE

## AidDistribution Events

### `RoleAssigned(address indexed account, StakeholderType role)`
- **Emitted**: When a role is assigned via `setRole()` or `daoApproveStore()`
- **Parameters**:
  - `account`: Address that received the role
  - `role`: StakeholderType enum value

### `ItemTypeCreated(uint256 indexed tokenId, bool isVoucher, address allowedStore, uint256 expiry, uint256 beneficiaryLimit, uint256 storeLimit)`
- **Emitted**: When an organisation creates a new item type
- **Parameters**: All ItemType struct fields

### `Converted(address indexed organisation, uint256 moneySpent, uint256 indexed tokenId, uint256 amountMinted)`
- **Emitted**: When TOKEN_MONEY is converted to item tokens
- **Parameters**:
  - `organisation`: Organisation performing conversion
  - `moneySpent`: Amount of TOKEN_MONEY burned
  - `tokenId`: Item token ID minted
  - `amountMinted`: Amount of item tokens minted

### `Assigned(address indexed organisation, address indexed beneficiary, uint256 indexed tokenId, uint256 amount)`
- **Emitted**: When item tokens are assigned to a beneficiary
- **Parameters**: All assignment details

### `Redeemed(address indexed store, address indexed beneficiary, uint256 indexed tokenId, uint256 amount)`
- **Emitted**: When a store redeems tokens for a beneficiary
- **Parameters**: All redemption details

### `DonorWithdrawal(address indexed donor, uint256 amountWei)`
- **Emitted**: When a donor withdraws ETH
- **Parameters**: Donor address and withdrawal amount

### `StoreWithdrawal(address indexed store, uint256 amountWei)`
- **Emitted**: When a store withdraws pending ETH
- **Parameters**: Store address and withdrawal amount

### `DaoContractUpdated(address indexed previousDao, address indexed newDao)`
- **Emitted**: When DAO contract address is updated
- **Parameters**: Previous and new DAO addresses

### `StoreApproved(uint256 indexed storeId, address indexed store)`
- **Emitted**: When DAO approves a store
- **Parameters**: Store ID and address

## StoreDao Events

### `StoreProposalCreated(uint256 indexed proposalId, address indexed proposer, address indexed store, uint256 startTime, uint256 endTime)`
- **Emitted**: When a new store proposal is created
- **Parameters**: All proposal creation details

### `StoreVoteCast(uint256 indexed proposalId, address indexed voter, uint8 credibilityScore, VoteChoice choice)`
- **Emitted**: When an organisation votes on a proposal
- **Parameters**:
  - `proposalId`: Proposal being voted on
  - `voter`: Organisation voting
  - `credibilityScore`: RNG-generated score (0, 50, or 100)
  - `choice`: VoteChoice enum (Against, For, Abstain)

### `StoreProposalExecuted(uint256 indexed proposalId, address indexed store, bool passed, uint256 storeId)`
- **Emitted**: When a proposal is executed
- **Parameters**:
  - `proposalId`: Proposal executed
  - `store`: Store address in proposal
  - `passed`: Whether proposal passed
  - `storeId`: Store ID if passed, 0 if failed

---

## WORKFLOWS & USE CASES

## Workflow 1: Basic Donation Flow

### Steps:
1. **Donor Deposits ETH**
   - Call: `depositMoney(1 ether)` with 1 ETH
   - Result: Donor receives 1 TOKEN_MONEY token, contract holds 1 ETH

2. **Donor Assigns to Organisation**
   - Call: `assignToOrganisation(orgAddress, 0.5 ether)`
   - Result: 0.5 TOKEN_MONEY transferred to organisation

3. **Organisation Creates Item Type**
   - Call: `createItemType(false, address(0), 0, 10, 100)`
   - Result: New tokenId created (e.g., tokenId = 1) for "Food Package"

4. **Organisation Converts Money to Goods**
   - Call: `convertTokenisedMoney(0.5 ether, 1, 100)`
   - Result: 0.5 TOKEN_MONEY burned, 100 Food Package tokens minted
   - Exchange Rate: 0.005 ETH per token

5. **Organisation Assigns to Beneficiary**
   - Call: `assignToBeneficiary(beneficiaryAddress, 1, 10)`
   - Result: Beneficiary receives 10 Food Package tokens

6. **Store Redeems Tokens**
   - Call: `redeem(beneficiaryAddress, 1, 5)`
   - Result: 5 tokens burned, `storePendingWei[store] += 5`

7. **Store Withdraws ETH**
   - Call: `storeWithdrawSGD(5)`
   - Result: Store receives 5 wei (0.000000005 ETH)

### Important Note:
The redemption system adds token `amount` (in wei) to `storePendingWei`, not the ETH value. This means if you redeem 5 tokens, the store gets 5 wei, not 5 ETH worth. This appears to be a design choice where 1 token = 1 wei.

## Workflow 2: Voucher System

### Steps:
1. **Organisation Creates Voucher Type**
   - Call: `createItemType(true, storeAddress, futureTimestamp, 5, 50)`
   - Parameters:
     - `isVoucher = true`
     - `allowedStore = specificStoreAddress`
     - `expiry = block.timestamp + 86400` (24 hours)
   - Result: Voucher tokenId created with restrictions

2. **Organisation Converts Money to Vouchers**
   - Call: `convertTokenisedMoney(0.1 ether, voucherTokenId, 20)`
   - Result: 20 voucher tokens minted

3. **Organisation Assigns Vouchers**
   - Call: `assignToBeneficiary(beneficiaryAddress, voucherTokenId, 5)`
   - Result: Beneficiary receives 5 vouchers

4. **Store Redeems Voucher**
   - Call: `redeem(beneficiaryAddress, voucherTokenId, 1)`
   - Validations:
     - Must be `allowedStore`
     - Must be before `expiry`
   - Result: Voucher redeemed, storePendingWei increased

## Workflow 3: DAO Store Approval

### Steps:
1. **Deploy Contracts**
   - Deploy AidDistribution
   - Deploy GovernanceToken
   - Deploy StoreDao (with token and aid addresses)
   - Call `aid.setDaoContract(daoAddress)`

2. **Setup Organizations**
   - Mint governance tokens: `gov.mint(org1, 1 ether)`
   - Assign roles: `aid.setRole(org1, 2)` (Organisation)

3. **Create Proposal**
   - Call: `dao.proposeStore(storeCandidateAddress)`
   - Result: Proposal created with 3-day voting period

4. **Organizations Vote**
   - Call: `dao.castVote(proposalId)`
   - Result: RNG determines vote (Against/Abstain/For) and credibility (0/50/100)
   - Each organisation can vote once

5. **Execute Proposal** (after 3 days)
   - Call: `dao.executeProposal(proposalId)`
   - Result: If passed:
     - `forVotes > againstVotes`
     - Average credibility >= 0.5
     - Calls `aid.daoApproveStore(store)`
     - Store receives Store role and storeId

---

## SECURITY FEATURES

### 1. Reentrancy Protection
- **Implementation**: All state-changing functions use `nonReentrant` modifier
- **Protected Functions**:
  - `depositMoney()`
  - `donorWithdrawSGD()`
  - `assignToOrganisation()`
  - `convertTokenisedMoney()`
  - `assignToBeneficiary()`
  - `storeWithdrawSGD()`
  - `redeem()`

### 2. Access Control
- **Ownable**: Owner-only functions (`setRole`, `setDaoContract`)
- **Role-Based**: Functions check `roles[msg.sender]` for appropriate stakeholder type
- **DAO Integration**: `daoApproveStore()` only callable by `daoContract`

### 3. Input Validation
- Zero address checks: `require(account != address(0))`
- Amount checks: `require(amount > 0)`
- Balance checks: `require(balanceOf(...) >= amount)`
- Limit checks: Redemption limits enforced per beneficiary and store

### 4. Voucher Security
- Store restriction: Vouchers can only be redeemed at `allowedStore`
- Expiry check: `require(block.timestamp <= expiry)`
- Both checks enforced in `redeem()` function

### 5. ERC1155 Safe Transfers
- Uses `safeTransferFrom()` which checks receiver contract compatibility
- Prevents tokens from being stuck in non-compatible contracts

### 6. ETH Transfer Safety
- Uses `call{value: amount}("")` with return value check
- Reverts if ETH transfer fails: `require(ok, "eth send failed")`

---

## TESTING STRUCTURE

### Test File: `test/test_Donation.js`

### Test Suites:
1. **Role Management**
   - Owner can assign roles
   - Non-owner cannot assign roles
   - Zero address validation

2. **Money Donation and Management**
   - Deposit money and receive tokens
   - Mismatched amount validation
   - Donor withdrawal with gas measurement
   - Assignment to organisations

3. **Item Type Creation**
   - Physical good creation
   - Voucher creation
   - Access control
   - Voucher validation

4. **Token Conversion and Assignment**
   - Money to goods conversion
   - Assignment to beneficiaries
   - Money token assignment prevention

5. **Redemption and Store Operations**
   - Token redemption
   - Beneficiary limit enforcement
   - Store limit enforcement
   - Store withdrawal

6. **Voucher-Specific Functionality**
   - Store restriction enforcement
   - Expiry validation

7. **Edge Cases and Error Handling**
   - Insufficient balance scenarios
   - Zero amount operations
   - Invalid token IDs

8. **Complete Donation Flow**
   - End-to-end workflow test

9. **Reentrancy Protection**
   - Reentrant call prevention

10. **Access Control & Role Abuse**
    - Unauthorized access prevention

11. **Limit Enforcement**
    - Redemption limit validation

### Test Setup:
- Uses Hardhat with ethers.js v6
- Creates test accounts: owner, donor, organisation, beneficiary, store
- Deploys AidDistribution with metadata URI
- Sets up all roles in `beforeEach()`

---

## DEPLOYMENT PROCESS

### Deployment Script: `scripts/deploy.cjs`

### Steps:
1. **Get Signers**
   ```javascript
   const [deployer, org1, org2, storeCandidate] = await ethers.getSigners();
   ```

2. **Deploy AidDistribution**
   ```javascript
   const aid = await AidDistribution.deploy("https://example.com/{id}.json");
   ```

3. **Deploy GovernanceToken**
   ```javascript
   const gov = await GovernanceToken.deploy();
   ```

4. **Deploy StoreDao**
   ```javascript
   const dao = await StoreDao.deploy(govAddress, aidAddress);
   ```

5. **Wire DAO into AidDistribution**
   ```javascript
   await aid.setDaoContract(daoAddress);
   ```

6. **Mint Governance Tokens**
   ```javascript
   await gov.mint(org1.address, ethers.parseEther("1"));
   await gov.mint(org2.address, ethers.parseEther("1"));
   ```

7. **Assign Organisation Roles**
   ```javascript
   await aid.setRole(org1.address, 2);
   await aid.setRole(org2.address, 2);
   ```

### Network Configuration:
- **Hardhat Config**: `hardhat.config.cjs`
- **Solidity Version**: 0.8.19
- **Optimizer**: Enabled (50 runs)
- **Networks**: localhost (http://127.0.0.1:8545)

---

## TECHNICAL SPECIFICATIONS

### Solidity Version
- **Version**: ^0.8.19
- **Features Used**:
  - Enums
  - Structs
  - Mappings
  - Events
  - Modifiers
  - Inheritance

### OpenZeppelin Contracts Used
- **ERC1155**: Multi-token standard implementation
- **Ownable**: Access control for owner functions
- **ReentrancyGuard**: Protection against reentrancy attacks
- **ERC20**: Governance token standard

### Token Standards
- **ERC-1155**: Main contract uses this for multi-token support
  - Token ID 0: TOKEN_MONEY
  - Token ID 1+: Item tokens (goods/vouchers)
- **ERC-20**: GovernanceToken for DAO participation

### Gas Optimization
- **Optimizer**: Enabled with 50 runs
- **Storage**: Uses mappings for efficient lookups
- **Events**: Indexed parameters for efficient filtering

### Important Design Decisions

1. **Token ID 0 for Money**: Special constant `TOKEN_MONEY = 0` represents tokenized ETH
2. **Auto-incrementing IDs**: Both token IDs and store IDs auto-increment
3. **Redemption Tracking**: Separate mappings for beneficiary and store redemption totals
4. **Store Pending Wei**: Tracks ETH owed to stores (in wei, not ETH value)
5. **Credibility System**: RNG-based voting with credibility scores (0, 50, 100)
6. **Voting Period**: Fixed 3-day period for all proposals
7. **Proposal Passing**: Requires both majority and credibility threshold

### Known Considerations

1. **Redemption Value**: `storePendingWei` increases by token `amount` (in wei), not ETH value. This means 1 token redeemed = 1 wei added to pending balance, not the ETH equivalent.

2. **RNG Security**: The credibility oracle uses deterministic RNG based on block data. Not suitable for production without a secure randomness source.

3. **Governance Token**: 1 token = 1 membership (not vote weight). All organizations with tokens have equal voting power.

4. **No Token Burning**: Item tokens are burned on redemption, but there's no mechanism to burn unused tokens.

5. **No Pause Mechanism**: Contract has no pause functionality for emergency stops.

---

## ADDITIONAL CONTEXT

### File Structure
```
IS4302Group8/
├── contracts/
│   ├── AidDistribution.sol      # Main contract
│   ├── GovernanceToken.sol       # ERC20 governance token
│   └── IAidDistribution.sol      # Interface + StoreDao contract
├── test/
│   ├── test_Donation.js         # Comprehensive test suite
│   └── Lock.js                  # Default Hardhat test
├── scripts/
│   └── deploy.cjs               # Deployment script
├── hardhat.config.cjs           # Hardhat configuration
├── package.json                  # Dependencies
└── README.md                     # Project readme
```

### Dependencies
- **@openzeppelin/contracts**: ^4.9.6
- **hardhat**: ^2.26.5
- **ethers**: ^6.15.0
- **chai**: ^4.5.0
- **@nomicfoundation/hardhat-toolbox**: ^6.1.0

### Compilation
- Contracts compile to `artifacts/` directory
- Build info stored in `artifacts/build-info/`
- TypeChain types generated for TypeScript support

---

## SUMMARY

This codebase implements a complete blockchain-based charitable aid distribution system with:
- **Tokenization**: ETH → TOKEN_MONEY → Item Tokens
- **Role-Based Access**: 5 stakeholder types with specific permissions
- **DAO Governance**: Credibility-weighted voting for store approval
- **Redemption System**: Limits and tracking for beneficiary and store redemptions
- **Voucher Support**: Time-limited vouchers with store restrictions
- **Security**: Reentrancy protection, access control, input validation

The system is designed for transparency, traceability, and controlled distribution of charitable aid through blockchain technology.

---

**End of Documentation**

