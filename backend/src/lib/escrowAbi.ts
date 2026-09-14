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
  "function fundEscrow(bytes32 contractId, address freelancer, uint256 amount) external",
  "function releaseMilestone(bytes32 contractId, uint256 amount) external",
  "function refund(bytes32 contractId, string calldata reason) external",
  "function resolveDispute(bytes32 contractId, uint256 disputedAmount, uint256 providerBps) external",
  "function getEscrow(bytes32 contractId) external view returns (address client, address freelancer, uint256 funded, uint256 released, uint256 refunded, uint8 status)",
  "function remainingEscrow(bytes32 contractId) external view returns (uint256)",
  "event EscrowFunded(bytes32 indexed contractId, address indexed client, address indexed freelancer, uint256 amount)",
  "event MilestoneReleased(bytes32 indexed contractId, address indexed freelancer, uint256 amount)",
  "event Refunded(bytes32 indexed contractId, address indexed client, uint256 amount, string reason)",
  "event DisputeResolved(bytes32 indexed contractId, uint256 disputedAmount, uint256 providerShare, uint256 clientShare, uint256 providerBps)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;
