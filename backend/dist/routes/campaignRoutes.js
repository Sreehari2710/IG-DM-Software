import { Router } from 'express';
import { createCampaign, getCampaigns, getCampaignById, pauseCampaign, resumeCampaign, cancelCampaign, } from '../controllers/campaignController.js';
const router = Router();
router.post('/', createCampaign);
router.get('/user/:userId', getCampaigns);
router.get('/:id', getCampaignById);
router.patch('/:id/pause', pauseCampaign);
router.patch('/:id/resume', resumeCampaign);
router.patch('/:id/cancel', cancelCampaign);
export default router;
//# sourceMappingURL=campaignRoutes.js.map