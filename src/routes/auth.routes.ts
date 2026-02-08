import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/request-otp', authController.requestOTP);
router.post('/verify-otp', authController.verifyOTPAndLogin);

// Protected routes
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.post('/logout', authMiddleware, authController.logout);
router.post('/fcm-token', authMiddleware, authController.updateFCMToken);

// Contacts routes
router.get('/contacts', authMiddleware, authController.getContacts);
router.post('/contacts', authMiddleware, authController.addContact);
router.delete('/contacts/:contactId', authMiddleware, authController.removeContact);

// Blocked users routes
router.get('/blocked', authMiddleware, authController.getBlockedUsers);
router.post('/block/:userId', authMiddleware, authController.blockUser);
router.delete('/block/:userId', authMiddleware, authController.unblockUser);

// Account management
router.delete('/account', authMiddleware, authController.deleteAccount);

// Privacy settings
router.get('/settings/privacy', authMiddleware, authController.getPrivacySettings);
router.put('/settings/privacy', authMiddleware, authController.updatePrivacySettings);

export default router;
