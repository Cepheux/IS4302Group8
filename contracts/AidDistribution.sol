// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AidDistribution
 * @notice ERC-1155 contract to manage tokenised donation money, physical goods, and vouchers in a charitable aid system.
 */
contract AidDistribution is ERC1155, Ownable, ReentrancyGuard {
    enum StakeholderType { None, Donor, Organisation, Beneficiary, Store }
    
    mapping(address => StakeholderType) public roles;

    uint256 public constant TOKEN_MONEY = 0;

    uint256 private _nextTokenId = 1;

    struct ItemType {
        bool isVoucher;
        uint256 expiry;
        address allowedStore;
        uint256 beneficiaryLimit;
        uint256 storeLimit;
    }

    mapping(uint256 => ItemType) public itemInfo;
    mapping(uint256 => mapping(address => uint256)) private _beneficiaryRedeemed;
    mapping(uint256 => mapping(address => uint256)) private _storeRedeemed;
    mapping(address => uint256) public storePendingWei;

    // DAO integration: store registry and DAO address
    address public daoContract;
    uint256 private _nextStoreId = 1;
    mapping(uint256 => address) public storeById;
    mapping(address => uint256) public storeIdOf;

    event RoleAssigned(address indexed account, StakeholderType role);

    event ItemTypeCreated(
        uint256 indexed tokenId,
        bool isVoucher,
        address allowedStore,
        uint256 expiry,
        uint256 beneficiaryLimit,
        uint256 storeLimit
    );

    event Converted(address indexed organisation, uint256 moneySpent, uint256 indexed tokenId, uint256 amountMinted);

    event Assigned(address indexed organisation, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    event Redeemed(address indexed store, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    event DonorWithdrawal(address indexed donor, uint256 amountWei);

    event StoreWithdrawal(address indexed store, uint256 amountWei);

    // DAO-specific events
    event DaoContractUpdated(address indexed previousDao, address indexed newDao);
    event StoreApproved(uint256 indexed storeId, address indexed store);

    constructor(string memory uri_) ERC1155(uri_) {
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
        _mint(msg.sender, TOKEN_MONEY, amount, "");
    }

    function donorWithdrawEther(uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Donor, "not donor");
        require(amount > 0, "amount=0");
        _burn(msg.sender, TOKEN_MONEY, amount);
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
        safeTransferFrom(msg.sender, organisation, TOKEN_MONEY, amount, "");
    }

    function createItemType(
        bool isVoucher,
        address allowedStore,
        uint256 expiry,
        uint256 beneficiaryLimit,
        uint256 storeLimit
    ) external returns (uint256 tokenId) {
        require(roles[msg.sender] == StakeholderType.Organisation, "Only an Organisation can create item types");
        if (isVoucher) {
            require(allowedStore != address(0), "Voucher must have an allowed store");
            require(expiry == 0 || expiry > block.timestamp, "Expiry must be in the future if set");
        }
        require(beneficiaryLimit > 0 && storeLimit > 0, "Limits must be greater than 0");

        tokenId = _nextTokenId++;
        itemInfo[tokenId] = ItemType({
            isVoucher: isVoucher,
            expiry: expiry,
            allowedStore: allowedStore,
            beneficiaryLimit: beneficiaryLimit,
            storeLimit: storeLimit
        });

        emit ItemTypeCreated(tokenId, isVoucher, allowedStore, expiry, beneficiaryLimit, storeLimit);
    }

    function convertTokenisedMoney(uint256 moneyAmount, uint256 tokenId, uint256 tokenAmount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Organisation, "Caller must be an Organisation");
        require(tokenId != TOKEN_MONEY, "Target tokenId must not be TOKEN_MONEY");
        require(
            itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0,
            "Target token type does not exist"
        );
        require(moneyAmount > 0 && tokenAmount > 0, "Amounts must be greater than 0");
        require(balanceOf(msg.sender, TOKEN_MONEY) >= moneyAmount, "Insufficient tokenised money balance");

        _burn(msg.sender, TOKEN_MONEY, moneyAmount);
        _mint(msg.sender, tokenId, tokenAmount, "");

        emit Converted(msg.sender, moneyAmount, tokenId, tokenAmount);
    }

    function assignToBeneficiary(address beneficiary, uint256 tokenId, uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Organisation, "Caller must be an Organisation");
        require(roles[beneficiary] == StakeholderType.Beneficiary, "Recipient must be a Beneficiary");
        require(tokenId != TOKEN_MONEY, "Cannot assign money tokens to beneficiary");
        require(
            itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0,
            "Token type does not exist"
        );
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf(msg.sender, tokenId) >= amount, "Insufficient token balance to assign");

        safeTransferFrom(msg.sender, beneficiary, tokenId, amount, "");
        emit Assigned(msg.sender, beneficiary, tokenId, amount);
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

    function redeem(address beneficiary, uint256 tokenId, uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Store, "Caller must be a Store");
        require(roles[beneficiary] == StakeholderType.Beneficiary, "Target must be a Beneficiary");
        require(tokenId != TOKEN_MONEY, "Cannot redeem TOKEN_MONEY as goods");
        require(
            itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0,
            "Token type does not exist"
        );
        require(amount > 0, "Amount must be greater than 0");

        ItemType storage item = itemInfo[tokenId];

        if (item.isVoucher) {
            if (item.allowedStore != address(0)) {
                require(item.allowedStore == msg.sender, "This voucher cannot be redeemed at this store");
            }
            if (item.expiry != 0) {
                require(block.timestamp <= item.expiry, "Voucher has expired");
            }
        }

        uint256 newBeneficiaryTotal = _beneficiaryRedeemed[tokenId][beneficiary] + amount;
        require(newBeneficiaryTotal <= item.beneficiaryLimit, "Beneficiary redemption limit exceeded");

        uint256 newStoreTotal = _storeRedeemed[tokenId][msg.sender] + amount;
        require(newStoreTotal <= item.storeLimit, "Store redemption limit exceeded");

        require(balanceOf(beneficiary, tokenId) >= amount, "Beneficiary lacks enough tokens");

        _burn(beneficiary, tokenId, amount);
        _beneficiaryRedeemed[tokenId][beneficiary] = newBeneficiaryTotal;
        _storeRedeemed[tokenId][msg.sender] = newStoreTotal;

        storePendingWei[msg.sender] += amount;

        emit Redeemed(msg.sender, beneficiary, tokenId, amount);
    }
}
