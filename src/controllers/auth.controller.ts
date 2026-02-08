import { Response } from 'express';
import { User, Chat, Message } from '../models';
import { AuthRequest, generateToken, generateRefreshToken } from '../middleware/auth';
import { sendOTP, verifyOTP } from '../services/otp.service';

export const authController = {
    // Request OTP for login/signup
    async requestOTP(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { phone } = req.body;

            if (!phone) {
                res.status(400).json({ error: 'Phone number is required' });
                return;
            }

            // Validate phone format (basic validation)
            const phoneRegex = /^\+?[1-9]\d{9,14}$/;
            if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
                res.status(400).json({ error: 'Invalid phone number format' });
                return;
            }

            const result = await sendOTP(phone);

            if (result.success) {
                // Check if user exists
                const existingUser = await User.findOne({ phone });
                res.json({
                    message: result.message,
                    isNewUser: !existingUser,
                    // Only include OTP in development
                    ...(result.otp && { otp: result.otp }),
                });
            } else {
                res.status(500).json({ error: result.message });
            }
        } catch (error) {
            console.error('Request OTP error:', error);
            res.status(500).json({ error: 'Failed to send OTP' });
        }
    },

    // Verify OTP and login/register
    async verifyOTPAndLogin(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { phone, otp, name } = req.body;

            if (!phone || !otp) {
                res.status(400).json({ error: 'Phone and OTP are required' });
                return;
            }

            const verification = verifyOTP(phone, otp);

            if (!verification.valid) {
                res.status(400).json({ error: verification.message });
                return;
            }

            // Check if user exists
            let user = await User.findOne({ phone });
            let isNewUser = false;

            if (!user) {
                // Register new user
                if (!name) {
                    res.status(400).json({ error: 'Name is required for new users' });
                    return;
                }

                user = new User({
                    phone,
                    name,
                    isVerified: true,
                    status: 'online',
                });
                await user.save();
                isNewUser = true;
            } else {
                // Update user status
                user.status = 'online';
                user.isVerified = true;
                await user.save();
            }

            const token = generateToken(user._id.toString(), user.phone);
            const refreshToken = generateRefreshToken(user._id.toString());

            res.json({
                message: isNewUser ? 'Account created successfully' : 'Login successful',
                user: {
                    _id: user._id,
                    phone: user.phone,
                    name: user.name,
                    bio: user.bio,
                    avatar: user.avatar,
                    status: user.status,
                },
                token,
                refreshToken,
                isNewUser,
            });
        } catch (error) {
            console.error('Verify OTP error:', error);
            res.status(500).json({ error: 'Verification failed' });
        }
    },

    // Get current user profile
    async getProfile(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            res.json({ user: req.user });
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ error: 'Failed to get profile' });
        }
    },

    // Update profile
    async updateProfile(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { name, bio, avatar } = req.body;
            const updates: Partial<{ name: string; bio: string; avatar: string }> = {};

            if (name) updates.name = name;
            if (bio !== undefined) updates.bio = bio;
            if (avatar) updates.avatar = avatar;

            const user = await User.findByIdAndUpdate(
                req.userId,
                { $set: updates },
                { new: true, runValidators: true }
            );

            res.json({ user, message: 'Profile updated successfully' });
        } catch (error) {
            console.error('Update profile error:', error);
            res.status(500).json({ error: 'Failed to update profile' });
        }
    },

    // Logout
    async logout(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (req.user) {
                await User.findByIdAndUpdate(req.userId, {
                    status: 'offline',
                    lastSeen: new Date(),
                });
            }

            res.json({ message: 'Logged out successfully' });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Logout failed' });
        }
    },

    // Update FCM token for push notifications
    async updateFCMToken(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { fcmToken, action } = req.body;

            if (!fcmToken) {
                res.status(400).json({ error: 'FCM token is required' });
                return;
            }

            if (action === 'remove') {
                // Remove token (on logout)
                const { removeFCMToken } = await import('../services/notification.service');
                await removeFCMToken(req.userId!, fcmToken);
            } else {
                // Register token (on login / token refresh)
                const { registerFCMToken } = await import('../services/notification.service');
                await registerFCMToken(req.userId!, fcmToken);
            }

            res.json({ message: 'FCM token updated' });
        } catch (error) {
            console.error('Update FCM token error:', error);
            res.status(500).json({ error: 'Failed to update FCM token' });
        }
    },

    // Get user's contacts list
    async getContacts(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const user = await User.findById(req.userId).populate('contacts', 'name avatar status phone bio lastSeen');
            res.json({ contacts: user?.contacts || [] });
        } catch (error) {
            console.error('Get contacts error:', error);
            res.status(500).json({ error: 'Failed to get contacts' });
        }
    },

    // Add a contact by phone number or user ID
    async addContact(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { phone, userId: contactUserId } = req.body;

            if (!phone && !contactUserId) {
                res.status(400).json({ error: 'Phone number or user ID is required' });
                return;
            }

            // Find contact user
            let contactUser;
            if (contactUserId) {
                contactUser = await User.findById(contactUserId);
            } else {
                contactUser = await User.findOne({ phone: phone.replace(/\s/g, '') });
            }

            if (!contactUser) {
                res.status(404).json({ error: 'User not found. They need to sign up first.' });
                return;
            }

            if (contactUser._id.toString() === req.userId) {
                res.status(400).json({ error: 'You cannot add yourself as a contact' });
                return;
            }

            // Check if already a contact
            const currentUser = await User.findById(req.userId);
            if (currentUser?.contacts.some(c => c.toString() === contactUser!._id.toString())) {
                res.status(400).json({ error: 'This user is already in your contacts' });
                return;
            }

            // Add to both users' contacts (mutual)
            await User.findByIdAndUpdate(req.userId, {
                $addToSet: { contacts: contactUser._id },
            });
            await User.findByIdAndUpdate(contactUser._id, {
                $addToSet: { contacts: req.userId },
            });

            const updatedUser = await User.findById(req.userId).populate('contacts', 'name avatar status phone bio lastSeen');

            res.json({
                message: `${contactUser.name} added to contacts`,
                contact: {
                    _id: contactUser._id,
                    name: contactUser.name,
                    phone: contactUser.phone,
                    avatar: contactUser.avatar,
                    status: contactUser.status,
                    bio: contactUser.bio,
                },
                contacts: updatedUser?.contacts || [],
            });
        } catch (error) {
            console.error('Add contact error:', error);
            res.status(500).json({ error: 'Failed to add contact' });
        }
    },

    // Remove a contact
    async removeContact(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { contactId } = req.params;

            // Remove from both users' contacts
            await User.findByIdAndUpdate(req.userId, {
                $pull: { contacts: contactId },
            });
            await User.findByIdAndUpdate(contactId, {
                $pull: { contacts: req.userId },
            });

            res.json({ message: 'Contact removed' });
        } catch (error) {
            console.error('Remove contact error:', error);
            res.status(500).json({ error: 'Failed to remove contact' });
        }
    },

    // Get blocked users list
    async getBlockedUsers(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const user = await User.findById(req.userId).populate('blockedUsers', 'name avatar phone status bio lastSeen');
            res.json({ blockedUsers: user?.blockedUsers || [] });
        } catch (error) {
            console.error('Get blocked users error:', error);
            res.status(500).json({ error: 'Failed to get blocked users' });
        }
    },

    // Block a user
    async blockUser(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { userId } = req.params;

            if (userId === req.userId) {
                res.status(400).json({ error: 'You cannot block yourself' });
                return;
            }

            const targetUser = await User.findById(userId);
            if (!targetUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const currentUser = await User.findById(req.userId);
            if (currentUser?.blockedUsers.some(id => id.toString() === userId)) {
                res.status(400).json({ error: 'User is already blocked' });
                return;
            }

            await User.findByIdAndUpdate(req.userId, {
                $addToSet: { blockedUsers: userId },
            });

            res.json({ message: `${targetUser.name} has been blocked` });
        } catch (error) {
            console.error('Block user error:', error);
            res.status(500).json({ error: 'Failed to block user' });
        }
    },

    // Unblock a user
    async unblockUser(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const { userId } = req.params;

            const targetUser = await User.findById(userId);
            if (!targetUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            await User.findByIdAndUpdate(req.userId, {
                $pull: { blockedUsers: userId },
            });

            res.json({ message: `${targetUser.name} has been unblocked` });
        } catch (error) {
            console.error('Unblock user error:', error);
            res.status(500).json({ error: 'Failed to unblock user' });
        }
    },

    // Delete account permanently
    async deleteAccount(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

            // Remove user from all group chats
            await Chat.updateMany(
                { 'participants.user': userId, type: 'group' },
                { $pull: { participants: { user: userId }, archivedBy: userId } }
            );

            // Delete private chats entirely
            const privateChats = await Chat.find({ 'participants.user': userId, type: 'private' }).select('_id');
            const privateChatIds = privateChats.map(c => c._id);
            if (privateChatIds.length > 0) {
                await Message.deleteMany({ chat: { $in: privateChatIds } });
                await Chat.deleteMany({ _id: { $in: privateChatIds } });
            }

            // Delete user's messages in group chats
            await Message.updateMany(
                { sender: userId },
                { isDeleted: true, content: 'This message was deleted' }
            );

            // Delete user's statuses
            const { Status } = require('../models');
            await Status.deleteMany({ user: userId });

            // Delete the user
            await User.findByIdAndDelete(userId);

            res.json({ message: 'Account deleted successfully' });
        } catch (error) {
            console.error('Delete account error:', error);
            res.status(500).json({ error: 'Failed to delete account' });
        }
    },

    // Get privacy settings
    async getPrivacySettings(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const user = await User.findById(req.userId).select('settings');
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            res.json({ settings: user.settings });
        } catch (error) {
            console.error('Get privacy settings error:', error);
            res.status(500).json({ error: 'Failed to get privacy settings' });
        }
    },

    // Update privacy settings
    async updatePrivacySettings(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const {
                lastSeenVisibility,
                profilePhotoVisibility,
                aboutVisibility,
                groupsVisibility,
                readReceipts,
            } = req.body;

            const validVis = ['everyone', 'contacts', 'nobody'];
            const updates: Record<string, unknown> = {};

            if (lastSeenVisibility !== undefined) {
                if (!validVis.includes(lastSeenVisibility)) {
                    res.status(400).json({ error: 'Invalid lastSeenVisibility value' });
                    return;
                }
                updates['settings.lastSeenVisibility'] = lastSeenVisibility;
            }
            if (profilePhotoVisibility !== undefined) {
                if (!validVis.includes(profilePhotoVisibility)) {
                    res.status(400).json({ error: 'Invalid profilePhotoVisibility value' });
                    return;
                }
                updates['settings.profilePhotoVisibility'] = profilePhotoVisibility;
            }
            if (aboutVisibility !== undefined) {
                if (!validVis.includes(aboutVisibility)) {
                    res.status(400).json({ error: 'Invalid aboutVisibility value' });
                    return;
                }
                updates['settings.aboutVisibility'] = aboutVisibility;
            }
            if (groupsVisibility !== undefined) {
                if (!validVis.includes(groupsVisibility)) {
                    res.status(400).json({ error: 'Invalid groupsVisibility value' });
                    return;
                }
                updates['settings.groupsVisibility'] = groupsVisibility;
            }
            if (readReceipts !== undefined) {
                if (typeof readReceipts !== 'boolean') {
                    res.status(400).json({ error: 'readReceipts must be a boolean' });
                    return;
                }
                updates['settings.readReceipts'] = readReceipts;
            }

            if (Object.keys(updates).length === 0) {
                res.status(400).json({ error: 'No valid settings to update' });
                return;
            }

            const user = await User.findByIdAndUpdate(
                req.userId,
                { $set: updates },
                { new: true, runValidators: true }
            );

            res.json({ settings: user?.settings, message: 'Privacy settings updated' });
        } catch (error) {
            console.error('Update privacy settings error:', error);
            res.status(500).json({ error: 'Failed to update privacy settings' });
        }
    },
};
