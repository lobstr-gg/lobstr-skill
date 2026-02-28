import { formatUnits } from 'viem';

export const TIER_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Platinum',
};

export const REPUTATION_TIERS: Record<number, string> = {
  0: 'Bronze',
  1: 'Silver',
  2: 'Gold',
  3: 'Platinum',
};

export const AIRDROP_TIERS: Record<number, string> = {
  0: 'New',
  1: 'Active',
  2: 'PowerUser',
};

export const JOB_STATUS: Record<number, string> = {
  0: 'Created',
  1: 'Active',
  2: 'Delivered',
  3: 'Confirmed',
  4: 'Disputed',
  5: 'Released',
  6: 'Resolved',
  7: 'Cancelled',
};

export const CATEGORIES: Record<string, number> = {
  DATA_SCRAPING: 0,
  TRANSLATION: 1,
  WRITING: 2,
  CODING: 3,
  RESEARCH: 4,
  DESIGN: 5,
  MARKETING: 6,
  LEGAL: 7,
  FINANCE: 8,
  PHYSICAL_TASK: 9,
  OTHER: 10,
};

export const CATEGORY_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [v, k])
);

export function formatLob(amount: bigint): string {
  return formatUnits(amount, 18) + ' LOB';
}

export function formatEth(amount: bigint): string {
  return formatUnits(amount, 18) + ' ETH';
}

export function categoryToIndex(name: string): number {
  const upper = name.toUpperCase();
  if (!(upper in CATEGORIES)) {
    throw new Error(`Unknown category: ${name}. Available: ${Object.keys(CATEGORIES).join(', ')}`);
  }
  return CATEGORIES[upper];
}

// DisputeArbitration enums
export const DISPUTE_STATUS: Record<number, string> = {
  0: 'Open',
  1: 'EvidencePhase',
  2: 'Voting',
  3: 'Resolved',
  4: 'PanelPending',
  5: 'Appealed',
};

export const RULING: Record<number, string> = {
  0: 'Pending',
  1: 'BuyerWins',
  2: 'SellerWins',
  3: 'Draw',
};

export const ARBITRATOR_RANK: Record<number, string> = {
  0: 'None',
  1: 'Junior',
  2: 'Senior',
  3: 'Principal',
};

// TreasuryGovernor enums
export const PROPOSAL_STATUS: Record<number, string> = {
  0: 'Pending',
  1: 'Approved',
  2: 'Executed',
  3: 'Cancelled',
  4: 'Expired',
};

// SybilGuard enums
export const VIOLATION_TYPE: Record<number, string> = {
  0: 'SybilCluster',
  1: 'SelfDealing',
  2: 'CoordinatedVoting',
  3: 'ReputationFarming',
  4: 'MultisigAbuse',
  5: 'StakeManipulation',
  6: 'EvidenceFraud',
  7: 'IdentityFraud',
};

export const REPORT_STATUS: Record<number, string> = {
  0: 'Pending',
  1: 'Confirmed',
  2: 'Rejected',
  3: 'Expired',
};

export const LOAN_STATUS: Record<number, string> = {
  0: 'Requested',
  1: 'Active',
  2: 'Repaid',
  3: 'Liquidated',
  4: 'Cancelled',
};

export const LOAN_TERM: Record<number, string> = {
  0: '7 days',
  1: '14 days',
  2: '30 days',
  3: '90 days',
};

export const MILESTONE_NAMES: Record<number, string> = {
  0: 'JobComplete',
  1: 'ServiceListed',
  2: 'StakeActive',
  3: 'ReputationEarned',
  4: 'GovernanceVote',
};

export const MILESTONE_DESC: Record<number, string> = {
  0: 'Complete 1 job',
  1: 'Create 1 listing',
  2: 'Stake >= 100 LOB',
  3: 'Rep score >= 1000',
  4: 'Cast 1 arb vote',
};

export const INSURANCE_STATUS: Record<number, string> = {
  0: 'Active',
  1: 'ClaimFiled',
  2: 'ClaimApproved',
  3: 'ClaimDenied',
  4: 'Withdrawn',
};

export const SUBSCRIPTION_STATUS: Record<number, string> = {
  0: 'Active',
  1: 'Paused',
  2: 'Cancelled',
  3: 'Completed',
};

export const CREDIT_LINE_STATUS: Record<number, string> = {
  0: 'Inactive',
  1: 'Active',
  2: 'Suspended',
  3: 'Closed',
};

export const LIGHTNING_PROPOSAL_STATUS: Record<number, string> = {
  0: 'Active',
  1: 'Approved',
  2: 'Executed',
  3: 'Cancelled',
  4: 'Expired',
};

export const VESTING_STATUS: Record<number, string> = {
  0: 'Active',
  1: 'FullyVested',
  2: 'Revoked',
};

// RolePayroll enums
export const ROLE_TYPE: Record<number, string> = {
  0: 'Arbitrator',
  1: 'Moderator',
};

export const ROLE_RANK: Record<number, string> = {
  0: 'Junior',
  1: 'Senior',
  2: 'Principal',
};

export const ROLE_SLOT_STATUS: Record<number, string> = {
  0: 'Empty',
  1: 'Active',
  2: 'Suspended',
  3: 'Resigned',
};

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, 6) + ' USDC';
}
