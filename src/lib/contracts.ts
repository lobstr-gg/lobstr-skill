import { parseAbi, parseUnits, type Address } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  LOB_TOKEN_ABI,
  STAKING_MANAGER_ABI,
  ESCROW_ENGINE_ABI,
  DISPUTE_ARBITRATION_ABI,
} from 'openclaw';

/**
 * Approve LOB tokens and stake in a single flow.
 */
export async function approveAndStake(amount: string, password?: string) {
  const ws = ensureWorkspace();
  const publicClient = createPublicClient(ws.config);
  const { client: walletClient, address } = await createWalletClient(ws.config, ws.path, password);

  const tokenAddr = getContractAddress(ws.config, 'lobToken');
  const stakingAddr = getContractAddress(ws.config, 'stakingManager');
  const parsedAmount = parseUnits(amount, 18);

  const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
  const stakingAbi = parseAbi(STAKING_MANAGER_ABI as unknown as string[]);

  // Approve
  const approveTx = await walletClient.writeContract({
    address: tokenAddr,
    abi: tokenAbi,
    functionName: 'approve',
    args: [stakingAddr, parsedAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Stake
  const stakeTx = await walletClient.writeContract({
    address: stakingAddr,
    abi: stakingAbi,
    functionName: 'stake',
    args: [parsedAmount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: stakeTx });

  return { approveTx, stakeTx, receipt, address };
}

/**
 * Approve LOB tokens and create a job from a listing.
 */
export async function approveAndCreateJob(
  listingId: bigint,
  seller: Address,
  amount: string,
  tokenAddress: Address,
  password?: string
) {
  const ws = ensureWorkspace();
  const publicClient = createPublicClient(ws.config);
  const { client: walletClient, address } = await createWalletClient(ws.config, ws.path, password);

  const escrowAddr = getContractAddress(ws.config, 'escrowEngine');
  const parsedAmount = parseUnits(amount, 18);

  const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
  const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);

  // Approve token transfer to escrow
  const approveTx = await walletClient.writeContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: 'approve',
    args: [escrowAddr, parsedAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Create job
  const createTx = await walletClient.writeContract({
    address: escrowAddr,
    abi: escrowAbi,
    functionName: 'createJob',
    args: [listingId, seller, parsedAmount, tokenAddress],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });

  return { approveTx, createTx, receipt, address };
}

/**
 * Approve LOB tokens and stake as an arbitrator in a single flow.
 */
export async function approveAndStakeAsArbitrator(amount: string, password?: string) {
  const ws = ensureWorkspace();
  const publicClient = createPublicClient(ws.config);
  const { client: walletClient, address } = await createWalletClient(ws.config, ws.path, password);

  const tokenAddr = getContractAddress(ws.config, 'lobToken');
  const arbAddr = getContractAddress(ws.config, 'disputeArbitration');
  const parsedAmount = parseUnits(amount, 18);

  const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
  const arbAbi = parseAbi(DISPUTE_ARBITRATION_ABI as unknown as string[]);

  // Approve
  const approveTx = await walletClient.writeContract({
    address: tokenAddr,
    abi: tokenAbi,
    functionName: 'approve',
    args: [arbAddr, parsedAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Stake as arbitrator
  const stakeTx = await walletClient.writeContract({
    address: arbAddr,
    abi: arbAbi,
    functionName: 'stakeAsArbitrator',
    args: [parsedAmount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: stakeTx });

  return { approveTx, stakeTx, receipt, address };
}
