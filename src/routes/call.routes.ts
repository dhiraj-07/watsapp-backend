import { Router } from 'express';
import { callController } from '../controllers/call.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.post('/initiate', callController.initiateCall);
router.post('/:callId/accept', callController.acceptCall);
router.post('/:callId/reject', callController.rejectCall);
router.post('/:callId/end', callController.endCall);
router.get('/history', callController.getCallHistory);

export default router;
