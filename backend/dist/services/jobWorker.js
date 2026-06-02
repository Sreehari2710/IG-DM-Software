/**
 * DB-backed polling job worker.
 * Polls the JobQueue table every 5 seconds for QUEUED jobs,
 * respects per-campaign delay settings and hourly action limits.
 */
import { exec } from 'child_process';
import os from 'os';
import prisma from '../lib/prisma.js';
import { runInteraction } from './automationEngine.js';
let isProcessing = false;
const campaignCooldowns = new Map(); // Map<campaignId, nextAllowedTimestamp>
// ─── Startup Background Process Cleanup (Anti-Leak) ──────────────────────────
function cleanupOrphanedBrowsers() {
    const platform = os.platform();
    if (platform === 'win32') {
        // Targeted script that only stops chromium instances located within Playwright's local directories
        const command = 'powershell -NoProfile -Command "Get-Process | Where-Object { $_.Path -like \'*ms-playwright*\' } | Stop-Process -Force"';
        exec(command, (err) => {
            if (err) {
                console.log('[Worker] Target process cleanup check done (system restrictions bypassed).');
                return;
            }
            console.log('[Worker] Cleaned up any orphaned background browser processes from prior runs.');
        });
    }
    else if (platform === 'darwin' || platform === 'linux') {
        // On macOS/Linux, kill processes with 'ms-playwright' in their execution command path
        const command = "pkill -f 'ms-playwright'";
        exec(command, (err) => {
            // pkill exits with 1 if no processes match, which is not an error we need to warn about
            if (err) {
                console.log('[Worker] Target process cleanup check done.');
                return;
            }
            console.log('[Worker] Cleaned up any orphaned background browser processes from prior runs.');
        });
    }
}
// ─── Enqueue jobs for a campaign ─────────────────────────────────────────────
export async function enqueueJobs(campaignId, targets, messages) {
    // Pair each target with a random message from the pool
    const jobs = targets.map((target) => ({
        campaignId,
        interactionId: target,
        message: messages[Math.floor(Math.random() * messages.length)],
        status: 'QUEUED',
    }));
    await prisma.jobQueue.createMany({ data: jobs });
    console.log(`[Worker] Enqueued ${jobs.length} jobs for campaign ${campaignId}`);
}
// ─── Process one job tick ─────────────────────────────────────────────────────
async function processTick() {
    if (isProcessing)
        return;
    isProcessing = true;
    try {
        // Fetch all active QUEUED jobs
        const queuedJobs = await prisma.jobQueue.findMany({
            where: {
                status: 'QUEUED',
                retries: { lt: 2 }, // max 2 retries
                campaign: { status: { in: ['QUEUED', 'RUNNING'] } },
            },
            include: { campaign: true },
            orderBy: { createdAt: 'asc' },
        });
        if (queuedJobs.length === 0) {
            isProcessing = false;
            return;
        }
        // Find the first job whose campaign is not currently on cooldown
        const now = Date.now();
        const job = queuedJobs.find((j) => {
            const cooldown = campaignCooldowns.get(j.campaignId) ?? 0;
            return now >= cooldown;
        });
        if (!job) {
            // All active campaigns are waiting on their human delay cooldowns
            isProcessing = false;
            return;
        }
        const { campaign } = job;
        // Check hourly limit: count DONE jobs in this campaign in the last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCount = await prisma.jobQueue.count({
            where: {
                campaignId: campaign.id,
                status: 'DONE',
                executedAt: { gte: oneHourAgo },
            },
        });
        if (recentCount >= campaign.hourlyLimit) {
            console.log(`[Worker] Campaign ${campaign.id} hit hourly limit (${campaign.hourlyLimit}). Cooldown enforced...`);
            // Put campaign on a 10-minute cooldown to avoid hammering the DB
            campaignCooldowns.set(campaign.id, Date.now() + 10 * 60 * 1000);
            isProcessing = false;
            return;
        }
        // Mark campaign as RUNNING
        if (campaign.status === 'QUEUED') {
            await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
        }
        // Mark job as RUNNING
        await prisma.jobQueue.update({ where: { id: job.id }, data: { status: 'RUNNING' } });
        console.log(`[Worker] Processing job ${job.id} (${campaign.type}): ${job.interactionId}`);
        // Run the job
        await runInteraction(job.id);
        // Check if all jobs for this campaign are done
        const remaining = await prisma.jobQueue.count({
            where: { campaignId: campaign.id, status: { in: ['QUEUED', 'RUNNING'] } },
        });
        if (remaining === 0) {
            await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED' } });
            campaignCooldowns.delete(campaign.id); // Clear cooldown on completion
            console.log(`[Worker] Campaign ${campaign.id} COMPLETED`);
        }
        else {
            // Schedule the next job for this campaign using a non-blocking cooldown delay
            const delayMs = campaign.delayMin * 1000 +
                Math.random() * (campaign.delayMax - campaign.delayMin) * 1000;
            campaignCooldowns.set(campaign.id, Date.now() + delayMs);
            console.log(`[Worker] Campaign ${campaign.id} cooldown set: next job in ${(delayMs / 1000).toFixed(1)}s.`);
        }
    }
    catch (err) {
        console.error('[Worker] Tick error:', err);
    }
    finally {
        isProcessing = false;
    }
}
// ─── Start the worker ─────────────────────────────────────────────────────────
export async function startWorker() {
    // First, clean up any trapped, orphaned Playwright processes from previous runs
    cleanupOrphanedBrowsers();
    try {
        const recovery = await prisma.jobQueue.updateMany({
            where: { status: 'RUNNING' },
            data: { status: 'QUEUED' },
        });
        if (recovery.count > 0) {
            console.log(`[Worker] Recovered ${recovery.count} stuck RUNNING jobs back to QUEUED status.`);
        }
    }
    catch (err) {
        console.error('[Worker] Failed to recover stuck running jobs:', err);
    }
    console.log('[Worker] Job queue worker started — polling every 5s');
    setInterval(processTick, 5000);
}
//# sourceMappingURL=jobWorker.js.map