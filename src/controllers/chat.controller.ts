import { Response } from 'express';
import { Chat, Message, User, IUser } from '../models';
import { AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';

// Helper: filter a participant user object based on their privacy settings
function applyPrivacyFilter(
    participantUser: Record<string, unknown>,
    requestingUserId: string,
    requestingUserContacts: string[]
): Record<string, unknown> {
    if (!participantUser || !participantUser._id) return participantUser;
    const pId = participantUser._id.toString();
    if (pId === requestingUserId) return participantUser; // own data always visible

    const settings = (participantUser as Record<string, unknown>).settings as IUser['settings'] | undefined;
    if (!settings) return participantUser;

    const isContact = requestingUserContacts.includes(pId);
    const filtered = { ...participantUser };

    // Last seen / online visibility
    const lsVis = settings.lastSeenVisibility || 'everyone';
    if (lsVis === 'nobody' || (lsVis === 'contacts' && !isContact)) {
        filtered.lastSeen = undefined;
        if (filtered.status === 'online') filtered.status = 'offline';
    }

    // Profile photo visibility
    const ppVis = settings.profilePhotoVisibility || 'everyone';
    if (ppVis === 'nobody' || (ppVis === 'contacts' && !isContact)) {
        filtered.avatar = '';
    }

    // About visibility
    const abVis = settings.aboutVisibility || 'everyone';
    if (abVis === 'nobody' || (abVis === 'contacts' && !isContact)) {
        filtered.bio = '';
    }

    // Remove settings from response
    delete filtered.settings;
    return filtered;
}

export const chatController = {
    // Get all chats for user
    async getChats(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;

            // Get requesting user's contacts for privacy filtering
            const requestingUser = await User.findById(userId).select('contacts');
            const contactIds = (requestingUser?.contacts || []).map(c => c.toString());

            const chats = await Chat.find({
                'participants.user': userId,
                archivedBy: { $ne: userId },
            })
                .populate('participants.user', 'name avatar status lastSeen phone bio settings')
                .populate('lastMessage')
                .populate('createdBy', 'name avatar')
                .sort({ lastMessageAt: -1 });

            // Get unread counts for each chat
            const chatsWithUnread = await Promise.all(
                chats.map(async (chat) => {
                    const unreadCount = await Message.countDocuments({
                        chat: chat._id,
                        sender: { $ne: userId },
                        'readBy.user': { $ne: userId },
                        isDeleted: false,
                    });

                    const chatObj: any = chat.toObject();
                    // Apply privacy filters to participants
                    chatObj.participants = chatObj.participants.map((p: any) => ({
                        ...p,
                        user: applyPrivacyFilter(p.user as Record<string, unknown>, userId!, contactIds),
                    }));

                    // Get current user's pinned status from their participant record
                    const myParticipant = chat.participants.find(
                        p => p.user._id?.toString() === userId || p.user.toString() === userId
                    );
                    chatObj.isPinned = myParticipant?.isPinned || false;
                    chatObj.pinnedAt = myParticipant?.pinnedAt;

                    return {
                        ...chatObj,
                        unreadCount,
                    };
                })
            );

            res.json({ chats: chatsWithUnread });
        } catch (error) {
            console.error('Get chats error:', error);
            res.status(500).json({ error: 'Failed to get chats' });
        }
    },

    // Get or create private chat
    async getOrCreatePrivateChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { recipientId } = req.body;

            if (!recipientId) {
                res.status(400).json({ error: 'Recipient ID is required' });
                return;
            }

            // Check if recipient exists
            const recipient = await User.findById(recipientId);
            if (!recipient) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            // Find existing chat
            let chat = await Chat.findOne({
                type: 'private',
                'participants.user': { $all: [userId, recipientId] },
            }).populate('participants.user', 'name avatar status lastSeen phone');

            if (!chat) {
                // Create new chat
                chat = new Chat({
                    type: 'private',
                    participants: [
                        { user: userId, role: 'member' },
                        { user: recipientId, role: 'member' },
                    ],
                    createdBy: userId,
                });
                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen phone');
            }

            res.json({ chat });
        } catch (error) {
            console.error('Get/create chat error:', error);
            res.status(500).json({ error: 'Failed to get or create chat' });
        }
    },

    // Create group chat
    async createGroup(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { name, description, participants, avatar } = req.body;

            if (!name || !participants || participants.length < 1) {
                res.status(400).json({ error: 'Name and at least 1 participant required' });
                return;
            }

            // Create participants array with creator as admin
            const chatParticipants = [
                { user: userId, role: 'admin' as const },
                ...participants.map((p: string) => ({ user: p, role: 'member' as const })),
            ];

            const chat = new Chat({
                type: 'group',
                name,
                description,
                avatar,
                participants: chatParticipants,
                createdBy: userId,
            });

            await chat.save();
            await chat.populate('participants.user', 'name avatar status lastSeen phone');

            res.json({ chat, message: 'Group created successfully' });
        } catch (error) {
            console.error('Create group error:', error);
            res.status(500).json({ error: 'Failed to create group' });
        }
    },

    // Get chat messages
    async getMessages(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { limit = 50, before } = req.query;

            // Verify user is participant
            const chat = await Chat.findOne({
                _id: chatId,
                'participants.user': userId,
            });

            if (!chat) {
                res.status(404).json({ error: 'Chat not found' });
                return;
            }

            const query: Record<string, unknown> = {
                chat: chatId,
                deletedFor: { $ne: userId },
            };

            if (before) {
                query.createdAt = { $lt: new Date(before as string) };
            }

            const messages = await Message.find(query)
                .populate('sender', 'name avatar')
                .populate('replyTo')
                .sort({ createdAt: -1 })
                .limit(parseInt(limit as string));

            res.json({ messages: messages.reverse() });
        } catch (error) {
            console.error('Get messages error:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    },

    // Add participants to group
    async addParticipants(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { participants } = req.body;

            const chat = await Chat.findOne({
                _id: chatId,
                type: 'group',
                'participants.user': userId,
                'participants.role': 'admin',
            });

            if (!chat) {
                res.status(403).json({ error: 'Not authorized or chat not found' });
                return;
            }

            const newParticipants = participants
                .filter((p: string) => !chat.participants.some(cp => cp.user.toString() === p))
                .map((p: string) => ({ user: p, role: 'member' as const }));

            chat.participants.push(...newParticipants);
            await chat.save();
            await chat.populate('participants.user', 'name avatar status lastSeen phone');

            res.json({ chat, message: 'Participants added' });
        } catch (error) {
            console.error('Add participants error:', error);
            res.status(500).json({ error: 'Failed to add participants' });
        }
    },

    // Remove participant from group
    async removeParticipant(req: AuthRequest, res: Response): Promise<void> {
        try {
            const adminId = req.userId;
            const { chatId, userId: targetUserId } = req.params;

            const chat = await Chat.findOne({
                _id: chatId,
                type: 'group',
            });

            if (!chat) {
                res.status(404).json({ error: 'Group not found' });
                return;
            }

            // Check requester is admin
            const requesterParticipant = chat.participants.find(p => p.user.toString() === adminId);
            if (!requesterParticipant || requesterParticipant.role !== 'admin') {
                res.status(403).json({ error: 'Only admins can remove members' });
                return;
            }

            // Cannot remove the group creator
            if (chat.createdBy.toString() === targetUserId) {
                res.status(403).json({ error: 'Cannot remove the group creator' });
                return;
            }

            // Cannot remove yourself via this route
            if (adminId === targetUserId) {
                res.status(400).json({ error: 'Use leave group instead' });
                return;
            }

            chat.participants = chat.participants.filter(
                p => p.user.toString() !== targetUserId
            );
            await chat.save();
            await chat.populate('participants.user', 'name avatar status lastSeen phone bio');

            res.json({ chat, message: 'Participant removed' });
        } catch (error) {
            console.error('Remove participant error:', error);
            res.status(500).json({ error: 'Failed to remove participant' });
        }
    },

    // Make a member admin
    async makeAdmin(req: AuthRequest, res: Response): Promise<void> {
        try {
            const adminId = req.userId;
            const { chatId, userId: targetUserId } = req.params;

            const chat = await Chat.findOne({
                _id: chatId,
                type: 'group',
            });

            if (!chat) {
                res.status(404).json({ error: 'Group not found' });
                return;
            }

            // Check requester is admin
            const requesterParticipant = chat.participants.find(p => p.user.toString() === adminId);
            if (!requesterParticipant || requesterParticipant.role !== 'admin') {
                res.status(403).json({ error: 'Only admins can promote members' });
                return;
            }

            const targetParticipant = chat.participants.find(p => p.user.toString() === targetUserId);
            if (!targetParticipant) {
                res.status(404).json({ error: 'User is not a participant' });
                return;
            }

            targetParticipant.role = 'admin';
            await chat.save();
            await chat.populate('participants.user', 'name avatar status lastSeen phone bio');

            res.json({ chat, message: 'Admin added' });
        } catch (error) {
            console.error('Make admin error:', error);
            res.status(500).json({ error: 'Failed to make admin' });
        }
    },

    // Remove admin role from a member
    async removeAdmin(req: AuthRequest, res: Response): Promise<void> {
        try {
            const adminId = req.userId;
            const { chatId, userId: targetUserId } = req.params;

            const chat = await Chat.findOne({
                _id: chatId,
                type: 'group',
            });

            if (!chat) {
                res.status(404).json({ error: 'Group not found' });
                return;
            }

            // Check requester is admin
            const requesterParticipant = chat.participants.find(p => p.user.toString() === adminId);
            if (!requesterParticipant || requesterParticipant.role !== 'admin') {
                res.status(403).json({ error: 'Only admins can demote admins' });
                return;
            }

            // Cannot remove admin from group creator
            if (chat.createdBy.toString() === targetUserId) {
                res.status(403).json({ error: 'Cannot remove admin from the group creator' });
                return;
            }

            const targetParticipant = chat.participants.find(p => p.user.toString() === targetUserId);
            if (!targetParticipant) {
                res.status(404).json({ error: 'User is not a participant' });
                return;
            }

            targetParticipant.role = 'member';
            await chat.save();
            await chat.populate('participants.user', 'name avatar status lastSeen phone bio');

            res.json({ chat, message: 'Admin removed' });
        } catch (error) {
            console.error('Remove admin error:', error);
            res.status(500).json({ error: 'Failed to remove admin' });
        }
    },

    // Leave group
    async leaveGroup(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;

            const chat = await Chat.findOne({
                _id: chatId,
                type: 'group',
                'participants.user': userId,
            });

            if (!chat) {
                res.status(404).json({ error: 'Chat not found' });
                return;
            }

            chat.participants = chat.participants.filter(
                p => p.user.toString() !== userId
            );

            // If no participants left, delete chat
            if (chat.participants.length === 0) {
                await Chat.findByIdAndDelete(chatId);
                res.json({ message: 'Group deleted' });
                return;
            }

            // If no admins left, make first participant admin
            const hasAdmin = chat.participants.some(p => p.role === 'admin');
            if (!hasAdmin && chat.participants.length > 0) {
                chat.participants[0].role = 'admin';
            }

            await chat.save();
            res.json({ message: 'Left group successfully' });
        } catch (error) {
            console.error('Leave group error:', error);
            res.status(500).json({ error: 'Failed to leave group' });
        }
    },

    // Update group info
    async updateGroup(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { name, description, avatar } = req.body;

            const chat = await Chat.findOneAndUpdate(
                {
                    _id: chatId,
                    type: 'group',
                    'participants.user': userId,
                    'participants.role': 'admin',
                },
                { $set: { name, description, avatar } },
                { new: true }
            ).populate('participants.user', 'name avatar status lastSeen phone');

            if (!chat) {
                res.status(403).json({ error: 'Not authorized or chat not found' });
                return;
            }

            res.json({ chat, message: 'Group updated' });
        } catch (error) {
            console.error('Update group error:', error);
            res.status(500).json({ error: 'Failed to update group' });
        }
    },

    // Search users
    async searchUsers(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { q } = req.query;

            if (!q || (q as string).length < 2) {
                res.json({ users: [] });
                return;
            }

            const users = await User.find({
                _id: { $ne: userId },
                $or: [
                    { name: { $regex: q, $options: 'i' } },
                    { phone: { $regex: q, $options: 'i' } },
                ],
            })
                .select('name avatar status phone bio')
                .limit(20);

            res.json({ users });
        } catch (error) {
            console.error('Search users error:', error);
            res.status(500).json({ error: 'Search failed' });
        }
    },

    // Archive all chats
    async archiveAll(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            await Chat.updateMany(
                { 'participants.user': userId },
                { $addToSet: { archivedBy: userId } }
            );
            res.json({ message: 'All chats archived' });
        } catch (error) {
            console.error('Archive all error:', error);
            res.status(500).json({ error: 'Failed to archive chats' });
        }
    },

    // Clear all chats (delete messages but keep chats)
    async clearAll(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const userChats = await Chat.find({ 'participants.user': userId }).select('_id');
            const chatIds = userChats.map(c => c._id);
            if (chatIds.length > 0) {
                await Message.updateMany(
                    { chat: { $in: chatIds } },
                    { $addToSet: { deletedFor: userId } }
                );
                // Reset last message
                await Chat.updateMany(
                    { _id: { $in: chatIds } },
                    { $unset: { lastMessage: 1 } }
                );
            }
            res.json({ message: 'All chats cleared' });
        } catch (error) {
            console.error('Clear all error:', error);
            res.status(500).json({ error: 'Failed to clear chats' });
        }
    },

    // Delete all chats
    async deleteAll(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;

            // Leave all group chats
            await Chat.updateMany(
                { 'participants.user': userId, type: 'group' },
                { $pull: { participants: { user: userId }, archivedBy: userId } }
            );

            // Delete private chats and their messages
            const privateChats = await Chat.find({ 'participants.user': userId, type: 'private' }).select('_id');
            const privateChatIds = privateChats.map(c => c._id);
            if (privateChatIds.length > 0) {
                await Message.deleteMany({ chat: { $in: privateChatIds } });
                await Chat.deleteMany({ _id: { $in: privateChatIds } });
            }

            res.json({ message: 'All chats deleted' });
        } catch (error) {
            console.error('Delete all chats error:', error);
            res.status(500).json({ error: 'Failed to delete chats' });
        }
    },
};
