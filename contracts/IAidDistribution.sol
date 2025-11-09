// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Minimal interface into AidDistribution used by the DAO.
 * roles() returns:
 * 0=None, 1=Donor, 2=Organisation, 3=Beneficiary, 4=Store.
 */
interface IAidDistribution {
    function roles(address account) external view returns (uint8);
    function daoApproveStore(address store) external returns (uint256 storeId);
}

/**
 * @title StoreDao
 * @notice DAO that lets organisations vote on which store addresses to approve.
 *         Uses a simple RNG-based "credibility" oracle with equal chance of 0, 0.5, 1.
 */
contract StoreDao {
    enum VoteChoice {
        Against,
        For,
        Abstain
    }

    struct Proposal {
        address proposer;
        address store;
        uint256 startTime;
        uint256 endTime;
        bool executed;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 numVotes;
        uint256 sumCredibility; // sum of per-vote scores: 0, 50, or 100
    }

    IERC20 public immutable governanceToken;
    IAidDistribution public immutable aid;

    uint256 public constant VOTING_PERIOD = 3 days;
    uint8 private constant ROLE_ORGANISATION = 2;

    uint256 public nextProposalId;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event StoreProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed store,
        uint256 startTime,
        uint256 endTime
    );

    event StoreVoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint8 credibilityScore, // 0, 50, or 100
        VoteChoice choice
    );

    event StoreProposalExecuted(
        uint256 indexed proposalId,
        address indexed store,
        bool passed,
        uint256 storeId
    );

    constructor(IERC20 _governanceToken, IAidDistribution _aid) {
        require(address(_governanceToken) != address(0), "gov token zero");
        require(address(_aid) != address(0), "aid zero");
        governanceToken = _governanceToken;
        aid = _aid;
    }

    modifier onlyOrganisationWithToken() {
        require(aid.roles(msg.sender) == ROLE_ORGANISATION, "not organisation");
        require(governanceToken.balanceOf(msg.sender) > 0, "no governance token");
        _;
    }

    /**
     * @notice Create a proposal to approve a new store address.
     * @param store Store address to be considered for approval.
     */
    function proposeStore(address store) external onlyOrganisationWithToken returns (uint256 proposalId) {
        require(store != address(0), "store zero");

        proposalId = ++nextProposalId;

        uint256 start = block.timestamp;
        uint256 end = start + VOTING_PERIOD;

        proposals[proposalId] = Proposal({
            proposer: msg.sender,
            store: store,
            startTime: start,
            endTime: end,
            executed: false,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            numVotes: 0,
            sumCredibility: 0
        });

        emit StoreProposalCreated(proposalId, msg.sender, store, start, end);
    }

    /**
     * @notice Cast a vote for a proposal. Each organisation can vote once per proposal.
     *         The choice is derived from a simple RNG credibility oracle:
     *         0   -> Against, credibility 0
     *         1   -> Abstain, credibility 50
     *         2   -> For, credibility 100
     */
    function castVote(uint256 proposalId) external onlyOrganisationWithToken {
        Proposal storage p = proposals[proposalId];
        require(p.proposer != address(0), "proposal not found");
        require(block.timestamp >= p.startTime, "voting not started");
        require(block.timestamp < p.endTime, "voting ended");
        require(!hasVoted[proposalId][msg.sender], "already voted");

        hasVoted[proposalId][msg.sender] = true;

        uint8 credibility = _drawCredibility(proposalId, msg.sender); // 0, 50, or 100
        VoteChoice choice;

        if (credibility == 0) {
            p.againstVotes += 1;
            choice = VoteChoice.Against;
        } else if (credibility == 50) {
            p.abstainVotes += 1;
            choice = VoteChoice.Abstain;
        } else {
            // 100
            p.forVotes += 1;
            choice = VoteChoice.For;
        }

        p.numVotes += 1;
        p.sumCredibility += credibility;

        emit StoreVoteCast(proposalId, msg.sender, credibility, choice);
    }

    /**
     * @notice Execute a proposal after the voting period.
     * @dev Any organisation with tokens can execute. If passed, calls AidDistribution.daoApproveStore.
     * @return storeId Store ID assigned inside AidDistribution (0 if proposal failed).
     */
    function executeProposal(uint256 proposalId)
        external
        onlyOrganisationWithToken
        returns (uint256 storeId)
    {
        Proposal storage p = proposals[proposalId];
        require(p.proposer != address(0), "proposal not found");
        require(block.timestamp >= p.endTime, "voting ongoing");
        require(!p.executed, "already executed");

        p.executed = true;

        if (p.numVotes == 0) {
            emit StoreProposalExecuted(proposalId, p.store, false, 0);
            return 0;
        }

        bool passed = _proposalPassed(p);

        if (!passed) {
            emit StoreProposalExecuted(proposalId, p.store, false, 0);
            return 0;
        }

        storeId = aid.daoApproveStore(p.store);
        emit StoreProposalExecuted(proposalId, p.store, true, storeId);
    }

    /**
     * @dev Proposal passes if:
     *      - forVotes > againstVotes (simple majority)
     *      - average credibility >= 0.5, i.e. sumCredibility >= 50 * numVotes.
     */
    function _proposalPassed(Proposal storage p) internal view returns (bool) {
        if (p.forVotes <= p.againstVotes) {
            return false;
        }
        uint256 requiredSum = 50 * p.numVotes;
        return p.sumCredibility >= requiredSum;
    }

    /**
     * @dev Simple RNG oracle with equal probability of 0, 0.5, 1.
     *      Returns 0, 50, or 100 as the credibility score.
     *      This is not secure randomness; it is a deterministic demo.
     */
    function _drawCredibility(uint256 proposalId, address voter) internal view returns (uint8) {
        // Using block.prevrandao for some entropy; fine for a toy example.
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.timestamp,
                    block.prevrandao,
                    proposalId,
                    voter
                )
            )
        );
        uint256 r = rand % 3;
        if (r == 0) {
            return 0;   // no
        } else if (r == 1) {
            return 50;  // maybe
        } else {
            return 100; // yes
        }
    }
}
