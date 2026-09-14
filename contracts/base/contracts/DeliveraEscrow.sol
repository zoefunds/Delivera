// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DeliveraEscrow
/// @notice Payment layer for Delivera, deployed on Base Sepolia. Holds real
///         USDC per work contract and pays it out on instruction from a
///         trusted relayer. All adjudication (milestone verification via AI
///         consensus, dispute arbitration) happens off this chain, on
///         GenLayer (contracts/delivera.py) — this contract only ever sees a
///         contract id, a milestone/refund amount, and — for disputes — a
///         provider/client basis-point split pushed here after GenLayer
///         finalizes a decision.
/// @dev No external dependencies (no OpenZeppelin import) so it can be
///      compiled/deployed with nothing more than solc, matching the sibling
///      MemeOlympicsEscrow.sol pattern this was copied from. Swap in OZ's
///      IERC20/SafeERC20/ReentrancyGuard later if this moves past a testnet
///      build.
// ----------------------------------------------------------------------
// Minimal ERC20 interface (USDC on Base Sepolia).
// ----------------------------------------------------------------------
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract DeliveraEscrow {
    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    uint256 public constant BPS_DENOMINATOR = 10000;

    enum EscrowStatus {
        NONE, // never funded
        FUNDED, // funded, work in progress
        SETTLED // fully released/refunded/cancelled — no further movement allowed
    }

    struct Escrow {
        address client; // party who funded the contract
        address freelancer; // party paid out via releaseMilestone / dispute splits
        uint256 funded; // total USDC ever deposited under this contract id
        uint256 released; // total USDC paid out to the freelancer so far
        uint256 refunded; // total USDC returned to the client so far
        EscrowStatus status;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer; // backend service authorized to act on GenLayer's decisions

    mapping(bytes32 => Escrow) public escrows; // contractId => escrow

    bool private _locked; // reentrancy guard

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event EscrowFunded(bytes32 indexed contractId, address indexed client, address indexed freelancer, uint256 amount);
    event MilestoneReleased(bytes32 indexed contractId, address indexed freelancer, uint256 amount);
    event Refunded(bytes32 indexed contractId, address indexed client, uint256 amount, string reason);
    event DisputeResolved(bytes32 indexed contractId, uint256 disputedAmount, uint256 providerShare, uint256 clientShare, uint256 providerBps);
    event EscrowSettled(bytes32 indexed contractId);
    event RelayerUpdated(address indexed newRelayer);
    event OwnerUpdated(address indexed newOwner);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "DeliveraEscrow: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "DeliveraEscrow: not relayer");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "DeliveraEscrow: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    /// @param usdcToken USDC contract address on Base Sepolia.
    /// @param relayer_ Backend service wallet allowed to release/refund/resolve.
    constructor(address usdcToken, address relayer_) {
        require(usdcToken != address(0), "DeliveraEscrow: zero usdc");
        require(relayer_ != address(0), "DeliveraEscrow: zero relayer");
        usdc = IERC20(usdcToken);
        owner = msg.sender;
        relayer = relayer_;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    function _remaining(Escrow storage e) internal view returns (uint256) {
        return e.funded - e.released - e.refunded;
    }

    function _closeIfExhausted(bytes32 contractId, Escrow storage e) internal {
        if (_remaining(e) == 0 && e.status == EscrowStatus.FUNDED) {
            e.status = EscrowStatus.SETTLED;
            emit EscrowSettled(contractId);
        }
    }

    // ------------------------------------------------------------------
    // Funding — the client deposits USDC for a work contract / job. Caller
    // must have approved this contract for `amount` beforehand. Can be
    // called more than once for the same contractId (e.g. topping up),
    // as long as it has not already been fully settled.
    // ------------------------------------------------------------------
    function fundEscrow(bytes32 contractId, address freelancer, uint256 amount) external nonReentrant {
        require(amount > 0, "DeliveraEscrow: amount must be > 0");
        require(freelancer != address(0), "DeliveraEscrow: zero freelancer");

        Escrow storage e = escrows[contractId];
        require(e.status != EscrowStatus.SETTLED, "DeliveraEscrow: contract already settled");

        if (e.status == EscrowStatus.NONE) {
            e.client = msg.sender;
            e.freelancer = freelancer;
            e.status = EscrowStatus.FUNDED;
        } else {
            require(e.client == msg.sender, "DeliveraEscrow: not the funding client");
            require(e.freelancer == freelancer, "DeliveraEscrow: freelancer mismatch");
        }

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "DeliveraEscrow: USDC transferFrom failed");

        e.funded += amount;
        emit EscrowFunded(contractId, msg.sender, freelancer, amount);
    }

    // ------------------------------------------------------------------
    // Relayer — pays out an approved milestone to the freelancer, mirroring
    // GenLayer's approve_milestone/_settle_milestone. Reverts once the
    // escrow is fully drained (released+refunded == funded), which blocks
    // double-release of the same funds.
    // ------------------------------------------------------------------
    function releaseMilestone(bytes32 contractId, uint256 amount) external onlyRelayer nonReentrant {
        Escrow storage e = escrows[contractId];
        require(e.status == EscrowStatus.FUNDED, "DeliveraEscrow: escrow not active");
        require(amount > 0, "DeliveraEscrow: amount must be > 0");
        require(amount <= _remaining(e), "DeliveraEscrow: amount exceeds remaining escrow");

        e.released += amount;

        bool ok = usdc.transfer(e.freelancer, amount);
        require(ok, "DeliveraEscrow: USDC transfer failed");

        emit MilestoneReleased(contractId, e.freelancer, amount);
        _closeIfExhausted(contractId, e);
    }

    // ------------------------------------------------------------------
    // Relayer — refunds remaining escrow to the client, mirroring GenLayer's
    // cancel_contract / _maybe_complete refund-of-leftovers path. Cancelling
    // a fully-drained or already-settled escrow reverts (idempotent).
    // ------------------------------------------------------------------
    function refund(bytes32 contractId, string calldata reason) external onlyRelayer nonReentrant {
        Escrow storage e = escrows[contractId];
        require(e.status == EscrowStatus.FUNDED, "DeliveraEscrow: escrow not active");

        uint256 remaining = _remaining(e);
        require(remaining > 0, "DeliveraEscrow: nothing left to refund");

        e.refunded += remaining;

        bool ok = usdc.transfer(e.client, remaining);
        require(ok, "DeliveraEscrow: USDC transfer failed");

        emit Refunded(contractId, e.client, remaining, reason);
        _closeIfExhausted(contractId, e);
    }

    // ------------------------------------------------------------------
    // Relayer — settles an open dispute per GenLayer's validator-consensus
    // arbitration (resolve_dispute), splitting `disputedAmount` of the
    // remaining escrow between freelancer and client in basis points
    // (10000 = 100% to the provider/freelancer; 0 = full refund to client).
    // ------------------------------------------------------------------
    function resolveDispute(bytes32 contractId, uint256 disputedAmount, uint256 providerBps) external onlyRelayer nonReentrant {
        Escrow storage e = escrows[contractId];
        require(e.status == EscrowStatus.FUNDED, "DeliveraEscrow: escrow not active");
        require(providerBps <= BPS_DENOMINATOR, "DeliveraEscrow: bps out of range");
        require(disputedAmount > 0, "DeliveraEscrow: amount must be > 0");
        require(disputedAmount <= _remaining(e), "DeliveraEscrow: amount exceeds remaining escrow");

        uint256 providerShare = (disputedAmount * providerBps) / BPS_DENOMINATOR;
        uint256 clientShare = disputedAmount - providerShare;

        e.released += providerShare;
        e.refunded += clientShare;

        if (providerShare > 0) {
            bool okP = usdc.transfer(e.freelancer, providerShare);
            require(okP, "DeliveraEscrow: USDC transfer to freelancer failed");
        }
        if (clientShare > 0) {
            bool okC = usdc.transfer(e.client, clientShare);
            require(okC, "DeliveraEscrow: USDC transfer to client failed");
        }

        emit DisputeResolved(contractId, disputedAmount, providerShare, clientShare, providerBps);
        _closeIfExhausted(contractId, e);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "DeliveraEscrow: zero relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DeliveraEscrow: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function getEscrow(bytes32 contractId)
        external
        view
        returns (address client, address freelancer, uint256 funded, uint256 released, uint256 refunded, EscrowStatus status)
    {
        Escrow storage e = escrows[contractId];
        return (e.client, e.freelancer, e.funded, e.released, e.refunded, e.status);
    }

    function remainingEscrow(bytes32 contractId) external view returns (uint256) {
        return _remaining(escrows[contractId]);
    }
}
