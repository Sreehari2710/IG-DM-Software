import { Router } from 'express';
import { connectInstagram, getInstagramStatus, updateSessionProxy, disconnectInstagram, } from '../controllers/instagramController.js';
const router = Router();
router.post('/connect', connectInstagram);
router.get('/status/:userId', getInstagramStatus);
router.patch('/proxy/:id', updateSessionProxy);
router.post('/disconnect', disconnectInstagram);
export default router;
//# sourceMappingURL=instagramRoutes.js.map