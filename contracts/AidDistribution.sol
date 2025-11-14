// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AidDistribution
 * @notice ERC-20 contract (AID_TOKEN) to manage tokenised donation money in a charitable aid system.
 */
contract AidDistribution is ERC20, Ownable, ReentrancyGuard {
    enum StakeholderType { None, Donor, Organisation, Beneficiary, Store }
    
    mapping(address => StakeholderType) public roles;

    mapping(address => uint256) public storePendingWei;

    // DAO integration: store registry and DAO address
    address public daoContract;
    uint256 private _nextStoreId = 1;
    mapping(uint256 => address) public storeById;
    mapping(address => uint256) public storeIdOf;


    //Events
    event RoleAssigned(address indexed account, StakeholderType role);

    event Converted(address indexed organisation, uint256 moneySpent, uint256 indexed tokenId, uint256 amountMinted);

    event Assigned(address indexed organisation, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    //event Redeemed(address indexed store, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    event DonorWithdrawal(address indexed donor, uint256 amountWei);

    event Purchased(address indexed beneficiary, address indexed store, uint256 amount);

    event StoreWithdrawal(address indexed store, uint256 amountWei);

    // DAO-specific events
    event DaoContractUpdated(address indexed previousDao, address indexed newDao);
    event StoreApproved(uint256 indexed storeId, address indexed store);

    constructor(string memory /*uri_*/) ERC20("Aid Token", "AID_TOKEN") {
        // Owner is set by Ownable.
    }

    /**
     * @notice Set the DAO contract that is allowed to approve new stores.
     */
    function setDaoContract(address newDao) external onlyOwner {
        require(newDao != address(0), "dao is zero");
        emit DaoContractUpdated(daoContract, newDao);
        daoContract = newDao;
    }

    /**
     * @notice Called by the DAO when a store proposal has passed governance.
     * @dev Assigns the Store role and, if needed, mints a new store ID.
     * @param store Store address being approved.
     * @return storeId Unique identifier for this store within AidDistribution.
     */
    function daoApproveStore(address store) external returns (uint256 storeId) {
        require(msg.sender == daoContract, "caller not dao");
        require(store != address(0), "store is zero");

        storeId = storeIdOf[store];
        if (storeId == 0) {
            storeId = _nextStoreId++;
            storeIdOf[store] = storeId;
            storeById[storeId] = store;
        }

        roles[store] = StakeholderType.Store;
        emit RoleAssigned(store, StakeholderType.Store);
        emit StoreApproved(storeId, store);
    }

    function setRole(address account, StakeholderType role) external onlyOwner {
        require(account != address(0), "Cannot assign role to zero address");
        roles[account] = role;
        emit RoleAssigned(account, role);
    }

    function depositMoney(uint256 amount) external payable nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value == amount, "Ether sent must equal the specified amount");
        _mint(msg.sender, amount);
    }

    function donorWithdrawEther(uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Donor, "not donor");
        require(amount > 0, "amount=0");
        _burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "eth send failed");
        emit DonorWithdrawal(msg.sender, amount);
    }

    function assignToOrganisation(address organisation, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(
            roles[msg.sender] == StakeholderType.Donor || roles[msg.sender] == StakeholderType.Organisation,
            "Caller must be Donor or Organisation"
        );
        require(roles[organisation] == StakeholderType.Organisation, "Recipient must be an Organisation");
        _transfer(msg.sender, organisation, amount);
    }

    function assignToBeneficiary(address beneficiary, uint256 amount) 
        external 
        nonReentrant 
        {
        require(roles[msg.sender] == StakeholderType.Organisation, "caller not organisation");
        require(roles[beneficiary] == StakeholderType.Beneficiary, "recipient not beneficiary");
        require(amount > 0, "amount=0");
        require(balanceOf(msg.sender) >= amount, "insufficient AID_TOKEN");

        _transfer(msg.sender, beneficiary, amount);
        emit Assigned(msg.sender, beneficiary, 0, amount);
    }

    function purchaseFromStore(address store, uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Beneficiary, "caller not beneficiary");
        require(roles[store] == StakeholderType.Store, "recipient not store");
        require(amount > 0, "amount=0");
        require(balanceOf(msg.sender) >= amount, "insufficient AID_TOKEN");

        // Burn AID_TOKEN from beneficiary
        _burn(msg.sender, amount);

        // Store gets ETH reimbursement credit
        storePendingWei[store] += amount;

        emit Purchased(msg.sender, store, amount);
    }

    function storeWithdrawEther(uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Store, "not store");
        require(amount > 0, "amount=0");
        uint256 owed = storePendingWei[msg.sender];
        require(owed >= amount, "insufficient pending");
        storePendingWei[msg.sender] = owed - amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "eth send failed");
        emit StoreWithdrawal(msg.sender, amount);
    }
}
