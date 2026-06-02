import { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { enqueueJobs } from '../services/jobWorker.js';

// ─── Create Campaign ─────────────────────────────────────────────────────────
export const createCampaign = async (req: Request, res: Response): Promise<void> => {
  const { userId, name, type, links, messages, delayMin, delayMax, hourlyLimit } = req.body as {
    userId: string;
    name: string;
    type: string;
    links: string[];
    messages: string[];
    delayMin?: number;
    delayMax?: number;
    hourlyLimit?: number;
  };

  if (!userId || !name || !type || !links?.length || !messages?.length) {
    res.status(400).json({ error: 'userId, name, type, links, and messages are required' });
    return;
  }

  try {
    // If campaign is DM type, clean targets to extract pure usernames from profile links or @handles
    let processedLinks = links;
    if (type === 'DM') {
      processedLinks = links
        .map(link => {
          const trimmed = link.trim();
          if (!trimmed) return '';
          if (trimmed.includes('instagram.com')) {
            try {
              const cleanUrl = trimmed.split('?')[0].split('#')[0];
              const parts = cleanUrl.split('/');
              const domainIndex = parts.findIndex(p => p.includes('instagram.com'));
              if (domainIndex !== -1 && parts.length > domainIndex + 1) {
                for (let i = domainIndex + 1; i < parts.length; i++) {
                  const val = parts[i].trim();
                  if (val) return val;
                }
              }
            } catch {
              // ignore
            }
            const match = trimmed.match(/instagram\.com\/([a-zA-Z0-9_\.]+)/i);
            if (match && match[1]) return match[1];
          }
          if (trimmed.startsWith('@')) {
            return trimmed.slice(1);
          }
          return trimmed;
        })
        .filter(u => u !== '');

      if (processedLinks.length === 0) {
        res.status(400).json({ error: 'Please enter at least one valid Instagram username or profile link.' });
        return;
      }
    }

    // Ensure campaign name is unique for this specific user (case-insensitive and trimmed)
    const existingCampaigns = await prisma.campaign.findMany({
      where: { userId },
      select: { name: true },
    });

    const isDuplicate = existingCampaigns.some(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    );

    if (isDuplicate) {
      res.status(400).json({ error: `A campaign named "${name}" already exists. Please choose a unique name.` });
      return;
    }

    // Find active session
    const session = await prisma.instagramSession.findFirst({
      where: { userId, isActive: true },
    });
    if (!session) {
      res.status(400).json({ error: 'No active Instagram session. Please connect your account first.' });
      return;
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        sessionId: session.id,
        name,
        type,
        links: JSON.stringify(processedLinks),
        messages: JSON.stringify(messages),
        delayMin: delayMin ?? 8,
        delayMax: delayMax ?? 20,
        hourlyLimit: hourlyLimit ?? 15,
        status: 'QUEUED',
      },
    });

    // Enqueue all jobs
    await enqueueJobs(campaign.id, processedLinks, messages);

    res.status(201).json({ success: true, campaign });
  } catch (err) {
    console.error('[Campaign] Create error:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
};

// ─── Get Campaigns ────────────────────────────────────────────────────────────
export const getCampaigns = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params as { userId: string };

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        jobs: { select: { status: true } },
      },
    });

    const result = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      createdAt: c.createdAt,
      delayMin: c.delayMin,
      delayMax: c.delayMax,
      hourlyLimit: c.hourlyLimit,
      total: c.jobs.length,
      done: c.jobs.filter((j) => j.status === 'DONE').length,
      failed: c.jobs.filter((j) => j.status === 'FAILED').length,
      queued: c.jobs.filter((j) => j.status === 'QUEUED').length,
    }));

    res.json(result);
  } catch (err) {
    console.error('[Campaign] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
};

// ─── Get Campaign by ID ───────────────────────────────────────────────────────
export const getCampaignById = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        jobs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json(campaign);
  } catch (err) {
    console.error('[Campaign] GetById error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
};

// ─── Pause Campaign ───────────────────────────────────────────────────────────
export const pauseCampaign = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  try {
    const campaign = await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });
    res.json(campaign);
  } catch (err) {
    console.error('[Campaign] Pause error:', err);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
};

// ─── Resume Campaign ──────────────────────────────────────────────────────────
export const resumeCampaign = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  try {
    const campaign = await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } });
    res.json(campaign);
  } catch (err) {
    console.error('[Campaign] Resume error:', err);
    res.status(500).json({ error: 'Failed to resume campaign' });
  }
};

// ─── Cancel Campaign ──────────────────────────────────────────────────────────
export const cancelCampaign = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  try {
    const campaign = await prisma.campaign.update({ where: { id }, data: { status: 'CANCELLED' } });
    res.json(campaign);
  } catch (err) {
    console.error('[Campaign] Cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
};
