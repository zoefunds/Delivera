// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice USDC custody with independently signed instructions, immutable
/// agreement allocations, and on-chain replay protection.
contract DeliveraEscrow {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant UNCONFIRMED_RECOVERY_DELAY = 7 days;
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    enum EscrowStatus { NONE, FUNDED, SETTLED }
    struct Escrow {
        address client; address freelancer; uint256 funded; uint256 released;
        uint256 refunded; uint256 milestoneCount; EscrowStatus status;
        uint256 fundedAt; bool activated;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    address public decisionAuthority;
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => mapping(uint256 => uint256)) public milestoneAllocation;
    mapping(bytes32 => mapping(uint256 => uint256)) public milestoneSettled;
    mapping(bytes32 => bool) public processedSettlements;
    bool private locked;

    event EscrowFunded(bytes32 indexed contractId, address indexed client, address indexed freelancer, uint256 amount, bytes32 allocationHash);
    event EscrowActivated(bytes32 indexed contractId);
    event UnconfirmedFundingRecovered(bytes32 indexed contractId, address indexed client, uint256 amount);
    event MilestoneReleased(bytes32 indexed contractId, bytes32 indexed settlementId, uint256 indexed milestoneIndex, address freelancer, uint256 amount);
    event Refunded(bytes32 indexed contractId, bytes32 indexed settlementId, address indexed client, uint256 amount, string reason);
    event DisputeResolved(bytes32 indexed contractId, bytes32 indexed settlementId, uint256 indexed milestoneIndex, uint256 disputedAmount, uint256 providerShare, uint256 clientShare, uint256 providerBps);
    event EscrowSettled(bytes32 indexed contractId);
    event RelayerUpdated(address indexed newRelayer);
    event DecisionAuthorityUpdated(address indexed newAuthority);
    event OwnerUpdated(address indexed newOwner);

    modifier onlyOwner() { require(msg.sender == owner, "DeliveraEscrow: not owner"); _; }
    modifier onlyRelayer() { require(msg.sender == relayer, "DeliveraEscrow: not relayer"); _; }
    modifier nonReentrant() { require(!locked, "DeliveraEscrow: reentrant call"); locked = true; _; locked = false; }

    constructor(address usdcToken, address relayer_, address authority_) {
        require(usdcToken != address(0) && relayer_ != address(0) && authority_ != address(0), "DeliveraEscrow: zero address");
        usdc = IERC20(usdcToken); owner = msg.sender; relayer = relayer_; decisionAuthority = authority_;
    }

    function _remaining(Escrow storage e) internal view returns (uint256) { return e.funded - e.released - e.refunded; }
    function _close(bytes32 id, Escrow storage e) internal {
        if (_remaining(e) == 0 && e.status == EscrowStatus.FUNDED) { e.status = EscrowStatus.SETTLED; emit EscrowSettled(id); }
    }
    function _domain(bytes32 payload) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("DELIVERA_ESCROW_V2", block.chainid, address(this), payload));
    }
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "DeliveraEscrow: bad signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
        require(uint256(s) <= HALF_N, "DeliveraEscrow: malleable signature");
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "DeliveraEscrow: bad signature v");
        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)), v, r, s);
    }
    function _authorize(bytes32 payload, uint256 deadline, bytes calldata sig) internal view {
        require(block.timestamp <= deadline, "DeliveraEscrow: authorization expired");
        require(_recover(_domain(payload), sig) == decisionAuthority, "DeliveraEscrow: invalid authority signature");
    }

    function fundingDigest(bytes32 id, address client, address freelancer, uint256[] calldata allocations, uint256 deadline) external view returns (bytes32) {
        return _domain(keccak256(abi.encode("FUND", id, client, freelancer, keccak256(abi.encode(allocations)), deadline)));
    }
    function settlementDigest(bytes32 sid, bytes32 id, uint8 action, uint256 index, uint256 amount, uint256 bps, uint256 deadline) external view returns (bytes32) {
        return _domain(keccak256(abi.encode("SETTLE", sid, id, action, index, amount, bps, deadline)));
    }
    function activationDigest(bytes32 id, uint256 deadline) external view returns (bytes32) {
        return _domain(keccak256(abi.encode("ACTIVATE", id, deadline)));
    }

    /// @notice Creates the immutable client/provider/id/allocation binding.
    /// A public id cannot be reserved without an authority signature for the caller.
    function fundEscrow(bytes32 id, address freelancer, uint256[] calldata allocations, uint256 deadline, bytes calldata sig) external nonReentrant {
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.NONE, "DeliveraEscrow: already funded");
        require(freelancer != address(0) && freelancer != msg.sender, "DeliveraEscrow: invalid freelancer");
        require(allocations.length > 0 && allocations.length <= 20, "DeliveraEscrow: invalid allocations");
        bytes32 allocationHash = keccak256(abi.encode(allocations));
        _authorize(keccak256(abi.encode("FUND", id, msg.sender, freelancer, allocationHash, deadline)), deadline, sig);
        uint256 total;
        for (uint256 i; i < allocations.length; i++) {
            require(allocations[i] > 0, "DeliveraEscrow: zero allocation");
            milestoneAllocation[id][i] = allocations[i]; total += allocations[i];
        }
        e.client = msg.sender; e.freelancer = freelancer; e.funded = total;
        e.milestoneCount = allocations.length; e.status = EscrowStatus.FUNDED;
        e.fundedAt = block.timestamp;
        require(usdc.transferFrom(msg.sender, address(this), total), "DeliveraEscrow: USDC transferFrom failed");
        emit EscrowFunded(id, msg.sender, freelancer, total, allocationHash);
    }

    /// @notice The decision authority signs this only after the matching
    /// GenLayer funding confirmation is FINALIZED. Anyone may transport the
    /// signature, so activation does not depend on the relayer account.
    function activateEscrow(bytes32 id, uint256 deadline, bytes calldata sig) external {
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.FUNDED && !e.activated, "DeliveraEscrow: cannot activate");
        _authorize(keccak256(abi.encode("ACTIVATE", id, deadline)), deadline, sig);
        e.activated = true;
        emit EscrowActivated(id);
    }

    /// @notice Escape hatch for a deposit whose GenLayer confirmation never
    /// finalized. Activated agreements and any agreement with a consumed
    /// milestone can never use this path, preserving provider entitlements.
    function recoverUnconfirmedFunding(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        require(msg.sender == e.client, "DeliveraEscrow: not client");
        require(e.status == EscrowStatus.FUNDED && !e.activated, "DeliveraEscrow: recovery unavailable");
        require(block.timestamp >= e.fundedAt + UNCONFIRMED_RECOVERY_DELAY, "DeliveraEscrow: recovery delay");
        uint256 amount = _remaining(e);
        require(amount == e.funded && e.released == 0 && e.refunded == 0, "DeliveraEscrow: entitlement exists");
        for (uint256 i; i < e.milestoneCount; i++) milestoneSettled[id][i] = milestoneAllocation[id][i];
        e.refunded = amount; e.status = EscrowStatus.SETTLED;
        require(usdc.transfer(e.client, amount), "DeliveraEscrow: USDC transfer failed");
        emit UnconfirmedFundingRecovered(id, e.client, amount); emit EscrowSettled(id);
    }

    function _begin(Escrow storage e, bytes32 sid, bytes32 id, uint8 action, uint256 index, uint256 amount, uint256 bps, uint256 deadline, bytes calldata sig) internal {
        require(e.status == EscrowStatus.FUNDED, "DeliveraEscrow: escrow not active");
        require(e.activated, "DeliveraEscrow: escrow not activated");
        require(sid != bytes32(0) && !processedSettlements[sid], "DeliveraEscrow: settlement already processed");
        require(amount > 0 && amount <= _remaining(e), "DeliveraEscrow: invalid amount");
        if (action != 3) require(index < e.milestoneCount, "DeliveraEscrow: bad milestone");
        _authorize(keccak256(abi.encode("SETTLE", sid, id, action, index, amount, bps, deadline)), deadline, sig);
        processedSettlements[sid] = true;
    }

    function releaseMilestone(bytes32 id, bytes32 sid, uint256 index, uint256 amount, uint256 deadline, bytes calldata sig) external onlyRelayer nonReentrant {
        Escrow storage e = escrows[id];
        _begin(e, sid, id, 1, index, amount, BPS_DENOMINATOR, deadline, sig);
        require(amount == milestoneAllocation[id][index], "DeliveraEscrow: release must equal allocation");
        require(milestoneSettled[id][index] == 0, "DeliveraEscrow: milestone already settled");
        milestoneSettled[id][index] = amount; e.released += amount;
        require(usdc.transfer(e.freelancer, amount), "DeliveraEscrow: USDC transfer failed");
        emit MilestoneReleased(id, sid, index, e.freelancer, amount); _close(id, e);
    }

    function resolveDispute(bytes32 id, bytes32 sid, uint256 index, uint256 amount, uint256 bps, uint256 deadline, bytes calldata sig) external onlyRelayer nonReentrant {
        require(bps <= BPS_DENOMINATOR, "DeliveraEscrow: bps out of range");
        Escrow storage e = escrows[id]; _begin(e, sid, id, 2, index, amount, bps, deadline, sig);
        require(amount == milestoneAllocation[id][index], "DeliveraEscrow: dispute must equal allocation");
        require(milestoneSettled[id][index] == 0, "DeliveraEscrow: milestone already settled");
        milestoneSettled[id][index] = amount;
        uint256 providerShare = amount * bps / BPS_DENOMINATOR; uint256 clientShare = amount - providerShare;
        e.released += providerShare; e.refunded += clientShare;
        if (providerShare > 0) require(usdc.transfer(e.freelancer, providerShare), "DeliveraEscrow: provider transfer failed");
        if (clientShare > 0) require(usdc.transfer(e.client, clientShare), "DeliveraEscrow: client transfer failed");
        emit DisputeResolved(id, sid, index, amount, providerShare, clientShare, bps); _close(id, e);
    }

    function refund(bytes32 id, bytes32 sid, uint256 amount, string calldata reason, uint256 deadline, bytes calldata sig) external onlyRelayer nonReentrant {
        Escrow storage e = escrows[id]; _begin(e, sid, id, 3, type(uint256).max, amount, 0, deadline, sig);
        uint256 refundable;
        for (uint256 i; i < e.milestoneCount; i++) {
            if (milestoneSettled[id][i] == 0) {
                uint256 allocation = milestoneAllocation[id][i]; milestoneSettled[id][i] = allocation; refundable += allocation;
            }
        }
        require(amount == refundable, "DeliveraEscrow: refund must equal unsettled allocations");
        e.refunded += amount; require(usdc.transfer(e.client, amount), "DeliveraEscrow: USDC transfer failed");
        emit Refunded(id, sid, e.client, amount, reason); _close(id, e);
    }

    function setRelayer(address a) external onlyOwner { require(a != address(0), "DeliveraEscrow: zero relayer"); relayer = a; emit RelayerUpdated(a); }
    function setDecisionAuthority(address a) external onlyOwner { require(a != address(0), "DeliveraEscrow: zero authority"); decisionAuthority = a; emit DecisionAuthorityUpdated(a); }
    function transferOwnership(address a) external onlyOwner { require(a != address(0), "DeliveraEscrow: zero owner"); owner = a; emit OwnerUpdated(a); }
    function getEscrow(bytes32 id) external view returns (address,address,uint256,uint256,uint256,uint256,EscrowStatus) {
        Escrow storage e = escrows[id]; return (e.client,e.freelancer,e.funded,e.released,e.refunded,e.milestoneCount,e.status);
    }
    function isActivated(bytes32 id) external view returns (bool) { return escrows[id].activated; }
    function fundingRecoveryState(bytes32 id) external view returns (uint256 fundedAt, bool activated, uint256 recoverableAt, bool recovered) {
        Escrow storage e = escrows[id];
        return (e.fundedAt, e.activated, e.fundedAt + UNCONFIRMED_RECOVERY_DELAY,
            e.status == EscrowStatus.SETTLED && e.released == 0 && e.refunded == e.funded);
    }
    function remainingEscrow(bytes32 id) external view returns (uint256) { return _remaining(escrows[id]); }
}
