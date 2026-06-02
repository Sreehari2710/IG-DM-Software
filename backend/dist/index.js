import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/authRoutes.js';
import instagramRoutes from './routes/instagramRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import { startWorker } from './services/jobWorker.js';
dotenv.config();
const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);
// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use(limiter);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/settings', settingsRoutes);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', port: PORT }));
// ─── Serve Frontend in Production ───────────────────────────────────────────
const frontendOutPath = path.join(__dirname, '../../frontend/out');
app.use(express.static(frontendOutPath, { extensions: ['html'] }));
// Fallback for Next.js client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendOutPath, 'index.html'));
});
// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
    console.log(`[Backend] Running on http://127.0.0.1:${PORT}`);
    startWorker();
    // Notify the Electron main process that the backend is fully booted and ready
    if (process.send) {
        process.send({ status: 'ready' });
    }
});
export default app;
//# sourceMappingURL=index.js.map