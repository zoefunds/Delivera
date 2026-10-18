/** Minimal ABIs for the Base Sepolia payment layer.
 *
 * DeliveraEscrow (contracts/base/DeliveraEscrow.sol, deployed separately)
 * escrows USDC per Delivera contract, keyed by a bytes32 id derived from the
 * GenLayer chainContractId. GenLayer decides *whether* a milestone is
 * approved or a dispute resolved; the relay (src/jobs/relay.ts) is the only
 * thing that ever moves the escrowed USDC, by calling releaseMilestone /
 * refund / resolveDispute here once a decision lands.
 *
 * This MUST match contracts/base/contracts/DeliveraEscrow.sol exactly —
 * the freelancer address and per-contract funded/released/refunded totals
 * live entirely on-chain (set once at fundEscrow time), so releaseMilestone
 * and refund take no address/index arguments of their own.
 */
export const DELIVERA_ESCROW_ABI = [
  "function fundEscrow(bytes32 contractId, address freelancer, uint256[] allocations, uint256 deadline, bytes authoritySignature) external",
  "function activateEscrow(bytes32 contractId, uint256 deadline, bytes authoritySignature) external",
  "function recoverUnconfirmedFunding(bytes32 contractId) external",
  "function releaseMilestone(bytes32 contractId, bytes32 settlementId, uint256 milestoneIndex, uint256 amount, uint256 deadline, bytes authoritySignature) external",
  "function refund(bytes32 contractId, bytes32 settlementId, uint256 amount, string reason, uint256 deadline, bytes authoritySignature) external",
  "function resolveDispute(bytes32 contractId, bytes32 settlementId, uint256 milestoneIndex, uint256 disputedAmount, uint256 providerBps, uint256 deadline, bytes authoritySignature) external",
  "function fundingDigest(bytes32 contractId, address client, address freelancer, uint256[] allocations, uint256 deadline) external view returns (bytes32)",
  "function settlementDigest(bytes32 settlementId, bytes32 contractId, uint8 action, uint256 milestoneIndex, uint256 amount, uint256 providerBps, uint256 deadline) external view returns (bytes32)",
  "function activationDigest(bytes32 contractId, uint256 deadline) external view returns (bytes32)",
  "function processedSettlements(bytes32 settlementId) external view returns (bool)",
  "function relayer() external view returns (address)",
  "function decisionAuthority() external view returns (address)",
  "function milestoneSettled(bytes32 contractId, uint256 milestoneIndex) external view returns (uint256)",
  "function getEscrow(bytes32 contractId) external view returns (address client, address freelancer, uint256 funded, uint256 released, uint256 refunded, uint256 milestoneCount, uint8 status)",
  "function remainingEscrow(bytes32 contractId) external view returns (uint256)",
  "function isActivated(bytes32 contractId) external view returns (bool)",
  "function fundingRecoveryState(bytes32 contractId) external view returns (uint256 fundedAt, bool activated, uint256 recoverableAt, bool recovered)",
  "event EscrowFunded(bytes32 indexed contractId, address indexed client, address indexed freelancer, uint256 amount, bytes32 allocationHash)",
  "event EscrowActivated(bytes32 indexed contractId)",
  "event UnconfirmedFundingRecovered(bytes32 indexed contractId, address indexed client, uint256 amount)",
  "event MilestoneReleased(bytes32 indexed contractId, bytes32 indexed settlementId, uint256 indexed milestoneIndex, address freelancer, uint256 amount)",
  "event Refunded(bytes32 indexed contractId, bytes32 indexed settlementId, address indexed client, uint256 amount, string reason)",
  "event DisputeResolved(bytes32 indexed contractId, bytes32 indexed settlementId, uint256 indexed milestoneIndex, uint256 disputedAmount, uint256 providerShare, uint256 clientShare, uint256 providerBps)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;
