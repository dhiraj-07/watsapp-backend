import { Router } from 'express';
import { chatController } from '../controllers/chat.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Chat routes
router.get('/', chatController.getChats);
router.post('/private', chatController.getOrCreatePrivateChat);
router.post('/group', chatController.createGroup);

// Specific chat routes
router.get('/:chatId/messages', chatController.getMessages);
router.post('/:chatId/participants', chatController.addParticipants);
router.delete('/:chatId/participants/:userId', chatController.removeParticipant);
router.post('/:chatId/participants/:userId/make-admin', chatController.makeAdmin);
router.post('/:chatId/participants/:userId/remove-admin', chatController.removeAdmin);
router.delete('/:chatId/leave', chatController.leaveGroup);
router.put('/:chatId', chatController.updateGroup);
router.post('/:chatId/mute', chatController.muteChat);
router.post('/:chatId/disappearing', chatController.setDisappearingMessages);
router.post('/:chatId/clear', chatController.clearChat);
router.delete('/:chatId', chatController.deleteChat);

// Common groups
router.get('/common-groups/:otherUserId', chatController.getCommonGroups);

// User search
router.get('/users/search', chatController.searchUsers);

// Bulk operations
router.post('/archive-all', chatController.archiveAll);
router.post('/clear-all', chatController.clearAll);
router.delete('/delete-all', chatController.deleteAll);

export default router;
