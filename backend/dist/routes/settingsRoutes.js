import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
const router = Router();
router.get('/:userId', getSettings);
router.patch('/:userId', updateSettings);
export default router;
//# sourceMappingURL=settingsRoutes.js.map