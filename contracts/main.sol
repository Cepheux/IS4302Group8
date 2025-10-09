// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AidDistribution
 * @notice ERC-1155 contract to manage tokenised donation money, physical goods, and vouchers in a charitable aid system.
 * @dev Extends OpenZeppelin ERC1155 for multi-token support (ensuring full ERC-1155 compatibility for transfers, batch operations, etc).
 *      Allows tracking of donations and distributions with role-based access control and on-chain enforcement of redemption limits.
 *      Stakeholder roles (Donor, Organisation, Beneficiary, Store) are mapped by address via an enum for flexible role management.
 *      Mapping-based limit tracking provides efficient O(1) lookups for redemption constraints, avoiding expensive iterations.
 */

contract AidDistribution is ERC1155, Ownable, ReentrancyGuard {
    /// @notice Enumeration of stakeholder roles for addresses.
    enum StakeholderType { None, Donor, Organisation, Beneficiary, Store }
    
    /// @notice Mapping from address to assigned stakeholder role.
    mapping(address => StakeholderType) public roles;

    /// @notice Token ID used to represent tokenised money (fungible donation currency).
    uint256 public constant TOKEN_MONEY = 0;

    /// @dev Internal counter for new token IDs for goods or vouchers (starts at 1 since 0 is reserved for money).
    uint256 private _nextTokenId = 1;

    /// @notice Structure defining properties of a tokenised item type (good or voucher).
    struct ItemType {
        bool isVoucher;          // true for vouchers, false for physical goods.
        uint256 expiry;          // Expiration timestamp for voucher (0 if none or not applicable).
        address allowedStore;    // If non-zero, only this store can redeem the token type; if zero, any store can redeem.
        uint256 beneficiaryLimit;// Max units of this token any single beneficiary can redeem.
        uint256 storeLimit;      // Max units of this token any single store can redeem.
    }

    /// @notice Mapping from token ID to its item type properties (for goods/vouchers; TOKEN_MONEY may not use these).
    mapping(uint256 => ItemType) public itemInfo;

    /// @notice Tracks how much of each token type each beneficiary has redeemed (for per-beneficiary limit enforcement).
    mapping(uint256 => mapping(address => uint256)) private _beneficiaryRedeemed;

    /// @notice Tracks how much of each token type each store has redeemed (for per-store limit enforcement).
    mapping(uint256 => mapping(address => uint256)) private _storeRedeemed;

    /// @notice Emitted when an address is assigned a stakeholder role.
    /// @param account The address being assigned a role.
    /// @param role The StakeholderType value representing the role.
    event RoleAssigned(address indexed account, StakeholderType role);

    /// @notice Emitted when a new item type (goods or voucher) is created by an Organisation.
    /// @param tokenId The newly created token type ID.
    /// @param isVoucher True if the item type is a voucher, false if a physical good.
    /// @param allowedStore The store address allowed to redeem this item (if restricted, or zero address if not restricted).
    /// @param expiry Expiry timestamp after which this voucher type cannot be redeemed (0 if no expiry).
    /// @param beneficiaryLimit Maximum units of this token that any one beneficiary can redeem.
    /// @param storeLimit Maximum units of this token that any one store can redeem.
    event ItemTypeCreated(
        uint256 indexed tokenId,
        bool isVoucher,
        address allowedStore,
        uint256 expiry,
        uint256 beneficiaryLimit,
        uint256 storeLimit
    );

    /// @notice Emitted when an Organisation converts tokenised money into a goods or voucher token.
    /// @param organisation The Organisation address performing the conversion.
    /// @param moneySpent Amount of tokenised money burned/spent in this conversion.
    /// @param tokenId The token type that was minted (goods or voucher).
    /// @param amountMinted The amount of new goods/voucher tokens minted to the Organisation.
    event Converted(address indexed organisation, uint256 moneySpent, uint256 indexed tokenId, uint256 amountMinted);

    /// @notice Emitted when an Organisation assigns goods or vouchers to a Beneficiary.
    /// @param organisation The Organisation address transferring the tokens.
    /// @param beneficiary The Beneficiary address receiving the tokens.
    /// @param tokenId The token type of the goods/vouchers assigned.
    /// @param amount The amount of tokens assigned to the beneficiary.
    event Assigned(address indexed organisation, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    /// @notice Emitted when a Store redeems goods or voucher tokens on behalf of a Beneficiary.
    /// @param store The Store address approving the redemption.
    /// @param beneficiary The Beneficiary address for whom the redemption is done.
    /// @param tokenId The token type of the goods or vouchers being redeemed.
    /// @param amount The amount of tokens redeemed (burned).
    event Redeemed(address indexed store, address indexed beneficiary, uint256 indexed tokenId, uint256 amount);

    /**
     * @notice Contract constructor that sets the base URI for token metadata.
     * @param uri_ The base metadata URI, with `{id}` placeholder for token IDs.
     * @dev The deployer is the initial owner (Ownable). Using OpenZeppelin ERC1155 to ensure full standard compliance.
     */
    constructor(string memory uri_) ERC1155(uri_) {
        // Owner is set by Ownable. No initial roles assigned by default.
    }

    /**
     * @notice Assigns a stakeholder role to an address (Donor, Organisation, Beneficiary, or Store).
     * @dev Only callable by the contract owner (administrator). Updates the `roles` mapping for the address.
     *      If the address already has a role, this will overwrite the old role with the new one.
     *      Emits a RoleAssigned event.
     * @param account The address to assign a role to.
     * @param role The StakeholderType to assign (1=Donor, 2=Organisation, 3=Beneficiary, 4=Store; 0 to revoke/clear role).
     * Global state:
     * - Writes to `roles[account]`.
     * Edge cases:
     * - Reverts if `account` is the zero address.
     * - Allows reassigning a new role to an address (any existing role is replaced).
     */
    function setRole(address account, StakeholderType role) external onlyOwner {
        require(account != address(0), "Cannot assign role to zero address");
        roles[account] = role;
        emit RoleAssigned(account, role);
    }

    /**
     * @notice Deposits funds and mints equivalent tokenised money to the donor's address.
     * @dev Mints ERC-1155 tokens of type TOKEN_MONEY to represent donated money. Assumes `msg.value` (in wei) is the deposited amount.
     *      If using an ERC20 stablecoin instead of ETH, this function would need to handle token transfer and accordingly mint internal credits (not implemented here).
     * @param amount The amount of tokenised money to mint (must match the Ether sent in `msg.value`).
     * Global state:
     * - Writes to the ERC-1155 balance of `msg.sender` for TOKEN_MONEY (mint).
     * - Emits an ERC1155 TransferSingle event for the mint.
     * Edge cases:
     * - Reverts if `amount` is 0.
     * - Reverts if `msg.value` is not equal to `amount` (to ensure the ether sent matches the token amount).
     * - If no ether is sent, the transaction reverts (as `msg.value` must match `amount`).
     */
    function depositMoney(uint256 amount) external payable nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value == amount, "Ether sent must equal the specified amount");
        _mint(msg.sender, TOKEN_MONEY, amount, "");
        // ERC1155 TransferSingle event emitted by _mint.
    }

    /**
     * @notice Transfers tokenised money from a Donor or Organisation to an Organisation (donation assignment).
     * @dev Initiates an ERC-1155 transfer of TOKEN_MONEY from the caller to the target organisation address.
     *      Can be used by a Donor to donate to an Organisation, or by an Organisation to forward funds to another Organisation.
     * @param organisation The recipient address, which must be assigned the Organisation role.
     * @param amount The amount of tokenised money to transfer.
     * Global state:
     * - Reads `roles` of caller and recipient for role verification.
     * - Updates balances of caller and recipient for TOKEN_MONEY (via transfer).
     * - Emits an ERC1155 TransferSingle event.
     * Edge cases:
     * - Reverts if `amount` is 0.
     * - Reverts if caller is not a Donor or Organisation role, or if recipient is not an Organisation role.
     * - Requires caller to have at least `amount` of TOKEN_MONEY (else the transfer will fail due to insufficient balance).
     */
    function assignToOrganisation(address organisation, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(
            roles[msg.sender] == StakeholderType.Donor || roles[msg.sender] == StakeholderType.Organisation,
            "Caller must be Donor or Organisation"
        );
        require(roles[organisation] == StakeholderType.Organisation, "Recipient must be an Organisation");
        safeTransferFrom(msg.sender, organisation, TOKEN_MONEY, amount, "");
    }

    /**
     * @notice Creates a new token type to represent a physical good or voucher.
     * @dev Only callable by an address with the Organisation role. Defines a new item type's properties and assigns a new token ID.
     *      Does not mint any tokens of this type yet (use `convertTokenisedMoney` to mint using donation funds).
     * @param isVoucher True if the new token type is a voucher (imposes store and expiry restrictions); false for a physical good.
     * @param allowedStore For vouchers: the store address that is allowed to redeem this voucher (or zero address if redeemable at any store).
     * @param expiry For vouchers: Unix timestamp after which the voucher expires (no redemption allowed past this date). Use 0 for no expiry or for goods.
     * @param beneficiaryLimit Maximum number of this token that any single Beneficiary can redeem.
     * @param storeLimit Maximum number of this token that any single Store can redeem.
     * @return tokenId The newly allocated token ID for the created item type.
     * Global state:
     * - Reads `roles` to ensure caller is an Organisation.
     * - Writes a new entry in `itemInfo` for the tokenId.
     * - Increments `_nextTokenId` for the next creation.
     * - Emits an ItemTypeCreated event.
     * Edge cases:
     * - Reverts if caller's role is not Organisation.
     * - If `isVoucher` is true: `allowedStore` must be a valid store address (non-zero) and `expiry` must be 0 or a future timestamp.
     * - Requires `beneficiaryLimit > 0` and `storeLimit > 0`.
     * - Token IDs start from 1 and increment to avoid clashing with TOKEN_MONEY (0).
     */
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

    /**
     * @notice Converts tokenised money held by an Organisation into a supply of a goods or voucher token.
     * @dev Burns a specified amount of the Organisation's TOKEN_MONEY and mints a specified amount of the target goods/voucher token to the Organisation.
     *      Used to reflect the use of donation funds to procure goods or vouchers off-chain, by updating on-chain balances.
     * @param moneyAmount The amount of tokenised money to spend (burn).
     * @param tokenId The token type ID of the goods or voucher to mint (must be created via `createItemType` and not equal to TOKEN_MONEY).
     * @param tokenAmount The amount of goods/voucher tokens to mint to the Organisation.
     * Global state:
     * - Reads `roles` to ensure caller is Organisation.
     * - Reads balance of caller's TOKEN_MONEY to ensure sufficient funds.
     * - Reads `itemInfo[tokenId]` to ensure the token type exists.
     * - Updates caller's TOKEN_MONEY balance (burn) and tokenId balance (mint).
     * - Emits a Converted event, and ERC1155 TransferSingle events for burn and mint.
     * Edge cases:
     * - Reverts if caller is not an Organisation.
     * - Reverts if `tokenId` is invalid (not created) or if `tokenId` == TOKEN_MONEY.
     * - Reverts if `moneyAmount` or `tokenAmount` is 0.
     * - Reverts if caller's TOKEN_MONEY balance is below `moneyAmount`.
     * - (No direct conversion of goods/vouchers back to money is provided in this design.)
     */
    function convertTokenisedMoney(uint256 moneyAmount, uint256 tokenId, uint256 tokenAmount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Organisation, "Caller must be an Organisation");
        require(tokenId != TOKEN_MONEY, "Target tokenId must not be TOKEN_MONEY");
        require(itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0, "Target token type does not exist");
        require(moneyAmount > 0 && tokenAmount > 0, "Amounts must be greater than 0");
        require(balanceOf(msg.sender, TOKEN_MONEY) >= moneyAmount, "Insufficient tokenised money balance");
        _burn(msg.sender, TOKEN_MONEY, moneyAmount);
        _mint(msg.sender, tokenId, tokenAmount, "");
        emit Converted(msg.sender, moneyAmount, tokenId, tokenAmount);
    }

    /**
     * @notice Assigns tokenised goods or vouchers from an Organisation to a Beneficiary.
     * @dev Transfers a specified amount of a goods/voucher token from the Organisation (caller) to the Beneficiary.
     *      Represents giving the beneficiary certain goods or a voucher for later redemption.
     * @param beneficiary The Beneficiary's address receiving the tokens.
     * @param tokenId The token type of the goods or voucher being assigned.
     * @param amount The amount of tokens to assign to the beneficiary.
     * Global state:
     * - Reads `roles` to validate caller is Organisation and recipient is Beneficiary.
     * - Reads caller's balance of `tokenId` to ensure availability.
     * - Updates balances of caller and beneficiary for `tokenId` (transfer).
     * - Emits an Assigned event and an ERC1155 TransferSingle event.
     * Edge cases:
     * - Reverts if caller is not an Organisation or if `beneficiary` is not a Beneficiary.
     * - Reverts if `tokenId` is invalid or if `tokenId` == TOKEN_MONEY (money should not be given directly to beneficiaries).
     * - Reverts if `amount` is 0.
     * - Reverts if caller's balance of the token is less than `amount`.
     * - If `beneficiary` is a smart contract, it must implement ERC1155Receiver to accept the tokens (or the transfer will revert).
     */
    function assignToBeneficiary(address beneficiary, uint256 tokenId, uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Organisation, "Caller must be an Organisation");
        require(roles[beneficiary] == StakeholderType.Beneficiary, "Recipient must be a Beneficiary");
        require(tokenId != TOKEN_MONEY, "Cannot assign money tokens to beneficiary");
        require(itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0, "Token type does not exist");
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf(msg.sender, tokenId) >= amount, "Insufficient token balance to assign");
        safeTransferFrom(msg.sender, beneficiary, tokenId, amount, "");
        emit Assigned(msg.sender, beneficiary, tokenId, amount);
    }

    /**
     * @notice Redeems tokenised goods or vouchers at a Store for a Beneficiary, enforcing usage limits.
     * @dev Allows a Store to burn a Beneficiary's goods/voucher tokens when the Beneficiary redeems them (e.g., receives the actual goods).
     *      Ensures that neither the beneficiary nor the store exceed their allowed redemption limits for this token type.
     * @param beneficiary The Beneficiary whose tokens are being redeemed.
     * @param tokenId The token type of the goods or voucher being redeemed.
     * @param amount The amount of tokens to redeem (will be burned).
     * Global state:
     * - Reads `roles` to verify caller is Store and `beneficiary` is Beneficiary.
     * - Reads `itemInfo[tokenId]` for voucher restrictions (expiry and allowed store) and limit values.
     * - Reads `_beneficiaryRedeemed[tokenId][beneficiary]` and `_storeRedeemed[tokenId][msg.sender]` for current redeemed counts.
     * - Updates `_beneficiaryRedeemed[tokenId][beneficiary]` and `_storeRedeemed[tokenId][msg.sender]` (adds the redeemed amount).
     * - Updates the beneficiary's balance of `tokenId` (burns the tokens).
     * - Emits a Redeemed event and an ERC1155 TransferSingle event.
     * Edge cases:
     * - Reverts if caller is not a Store or if `beneficiary` is not a Beneficiary.
     * - Reverts if `tokenId` is invalid or if `tokenId` == TOKEN_MONEY (cannot redeem money as goods).
     * - For vouchers: reverts if the store caller is not the `allowedStore` for this token type (when `allowedStore` is set).
     * - Reverts if the voucher has expired (when `expiry` is set and the current time is past expiry).
     * - Reverts if this redemption would cause the beneficiary's total redeemed or the store's total redeemed for this token to exceed their limits.
     * - Reverts if `beneficiary` does not have at least `amount` of the token.
     * - On success, the tokens are burned from the beneficiary, effectively using up the voucher/goods entitlement.
     */
    function redeem(address beneficiary, uint256 tokenId, uint256 amount) external nonReentrant {
        require(roles[msg.sender] == StakeholderType.Store, "Caller must be a Store");
        require(roles[beneficiary] == StakeholderType.Beneficiary, "Target must be a Beneficiary");
        require(tokenId != TOKEN_MONEY, "Cannot redeem TOKEN_MONEY as goods");
        require(itemInfo[tokenId].beneficiaryLimit != 0 || itemInfo[tokenId].storeLimit != 0, "Token type does not exist");
        require(amount > 0, "Amount must be greater than 0");
        ItemType storage item = itemInfo[tokenId];
        // Enforce voucher-specific constraints.
        if (item.isVoucher) {
            if (item.allowedStore != address(0)) {
                require(item.allowedStore == msg.sender, "This voucher cannot be redeemed at this store");
            }
            if (item.expiry != 0) {
                require(block.timestamp <= item.expiry, "Voucher has expired");
            }
        }
        // Enforce redemption limits.
        uint256 newBeneficiaryTotal = _beneficiaryRedeemed[tokenId][beneficiary] + amount;
        require(newBeneficiaryTotal <= item.beneficiaryLimit, "Beneficiary redemption limit exceeded");
        uint256 newStoreTotal = _storeRedeemed[tokenId][msg.sender] + amount;
        require(newStoreTotal <= item.storeLimit, "Store redemption limit exceeded");
        require(balanceOf(beneficiary, tokenId) >= amount, "Beneficiary lacks enough tokens");
        _burn(beneficiary, tokenId, amount);
        _beneficiaryRedeemed[tokenId][beneficiary] = newBeneficiaryTotal;
        _storeRedeemed[tokenId][msg.sender] = newStoreTotal;
        emit Redeemed(msg.sender, beneficiary, tokenId, amount);
    }
}
