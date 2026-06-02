import { Request, Response } from 'express';
import prisma from '../lib/prisma.js';

// ─── Get Settings ─────────────────────────────────────────────────────────────
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.userId as string;

  try {
    // Ensure user exists before upserting settings (avoids FK constraint on fresh DB)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.json({ delayMin: 8, delayMax: 20, hourlyLimit: 15 });
      return;
    }
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: {},
      create: { userId, delayMin: 8, delayMax: 20, hourlyLimit: 15 },
    });
    res.json(settings);
  } catch (err) {
    console.error('[Settings] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

// ─── Update Settings ──────────────────────────────────────────────────────────
export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.userId as string;
  const { delayMin, delayMax, hourlyLimit } = req.body as {
    delayMin?: number;
    delayMax?: number;
    hourlyLimit?: number;
  };

  try {
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: {
        ...(delayMin !== undefined && { delayMin }),
        ...(delayMax !== undefined && { delayMax }),
        ...(hourlyLimit !== undefined && { hourlyLimit }),
      },
      create: {
        userId,
        delayMin: delayMin ?? 8,
        delayMax: delayMax ?? 20,
        hourlyLimit: hourlyLimit ?? 15,
      },
    });
    res.json(settings);
  } catch (err) {
    console.error('[Settings] Update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
