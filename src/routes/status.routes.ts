import { Router } from 'express';
import { statusController } from '../controllers/status.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.post('/', statusController.createStatus);
router.get('/', statusController.getStatuses);
router.post('/:statusId/view', statusController.viewStatus);
router.get('/:statusId/viewers', statusController.getStatusViewers);
router.delete('/:statusId', statusController.deleteStatus);

export default router;
