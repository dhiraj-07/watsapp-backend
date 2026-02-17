import { Router } from 'express';
import { eventController } from '../controllers/event.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Get all events for a chat
router.get('/chat/:chatId', authMiddleware, eventController.getChatEvents);

// Get a single event
router.get('/:messageId', authMiddleware, eventController.getEvent);

export default router;
