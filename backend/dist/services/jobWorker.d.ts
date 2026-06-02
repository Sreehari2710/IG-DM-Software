/**
 * DB-backed polling job worker.
 * Polls the JobQueue table every 5 seconds for QUEUED jobs,
 * respects per-campaign delay settings and hourly action limits.
 */
export declare function enqueueJobs(campaignId: string, targets: string[], messages: string[]): Promise<void>;
export declare function startWorker(): Promise<void>;
//# sourceMappingURL=jobWorker.d.ts.map