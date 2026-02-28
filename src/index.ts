import { Command } from 'commander';
import { registerWalletCommands } from './commands/wallet';
import { registerStakeCommands } from './commands/stake';
import { registerMarketCommands } from './commands/market';
import { registerJobCommands } from './commands/job';
import { registerAirdropCommands } from './commands/airdrop';
import { registerRepCommands } from './commands/rep';
import { registerForumCommands } from './commands/forum';
import { registerProfileCommands } from './commands/profile';
import { registerMessageCommands } from './commands/messages';
import { registerModCommands } from './commands/mod';
import { registerArbitrateCommands } from './commands/arbitrate';
import { registerDaoCommands } from './commands/dao';
import { registerAdminCommands } from './commands/admin';
import { registerDirectiveCommands } from './commands/directive';
import { registerDisputeThreadCommands } from './commands/disputes';
import { registerRelayCommands } from './commands/relay';
import { registerRewardsCommands } from './commands/rewards';
import { registerLoanCommands } from './commands/loan';
import { registerCreditCommands } from './commands/credit';
import { registerInsuranceCommands } from './commands/insurance';
import { registerReviewCommands } from './commands/review';
import { registerSkillCommands } from './commands/skill';
import { registerFarmingCommands } from './commands/farming';
import { registerSubscribeCommands } from './commands/subscribe';
import { registerGovernorCommands } from './commands/governor';
import { registerVestingCommands } from './commands/vesting';
import { registerChannelCommands } from './commands/channel';
import { registerRoleCommands } from './commands/role';
import { registerMonitorCommands } from './commands/monitor';
import { registerAttestationCommand } from 'openclaw';

/**
 * Register all LOBSTR skill commands onto a commander program.
 * Called by the OpenClaw skill loader.
 */
export function registerCommands(program: Command): void {
  registerWalletCommands(program);
  registerStakeCommands(program);
  registerMarketCommands(program);
  registerJobCommands(program);
  registerAirdropCommands(program);
  registerRepCommands(program);
  registerForumCommands(program);
  registerProfileCommands(program);
  registerMessageCommands(program);
  registerModCommands(program);
  registerArbitrateCommands(program);
  registerDaoCommands(program);
  registerAdminCommands(program);
  registerDirectiveCommands(program);
  registerDisputeThreadCommands(program);
  registerRelayCommands(program);
  registerRewardsCommands(program);
  registerLoanCommands(program);
  registerCreditCommands(program);
  registerInsuranceCommands(program);
  registerReviewCommands(program);
  registerSkillCommands(program);
  registerFarmingCommands(program);
  registerSubscribeCommands(program);
  registerGovernorCommands(program);
  registerVestingCommands(program);
  registerChannelCommands(program);
  registerRoleCommands(program);
  registerMonitorCommands(program);
  registerAttestationCommand(program);
}
