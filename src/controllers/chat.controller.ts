import { Response } from 'express';
import { Chat, Message, User, IUser } from '../models';
import { AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';
import { isBlocked } from '../utils/block';

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
                .populate('participants.user', 'name avatar status lastSeen email phone bio settings')
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
                    // Filter out participants whose user was deleted from the database
                    chatObj.participants = chatObj.participants
                        .filter((p: any) => p.user != null)
                        .map((p: any) => ({
                            ...p,
                            user: applyPrivacyFilter(p.user as Record<string, unknown>, userId!, contactIds),
                        }));

                    // Get current user's pinned status from their participant record
                    const myParticipant = chat.participants.find(
                        p => p.user && (p.user._id?.toString() === userId || p.user.toString() === userId)
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

            // Block check — can still open existing chat (to see history) but not create new
            const blocked = await isBlocked(userId!, recipientId);

            // Find existing chat
            let chat = await Chat.findOne({
                type: 'private',
                'participants.user': { $all: [userId, recipientId] },
            }).populate('participants.user', 'name avatar status lastSeen email phone');

            if (!chat) {
                // Don't allow creating a new chat if blocked
                if (blocked) {
                    res.status(403).json({ error: 'Cannot create chat with this user' });
                    return;
                }
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
                await chat.populate('participants.user', 'name avatar status lastSeen email phone');
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
            await chat.populate('participants.user', 'name avatar status lastSeen email phone');

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
                .populate({
                    path: 'replyTo',
                    populate: { path: 'sender', select: 'name avatar' }
                })
                .populate('poll.options.votes', 'name avatar')
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
            await chat.populate('participants.user', 'name avatar status lastSeen email phone');

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
            ).populate('participants.user', 'name avatar status lastSeen email phone');

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
                    { email: { $regex: q, $options: 'i' } },
                ],
            })
                .select('name avatar status email phone bio')
                .limit(20);

            res.json({ users });
        } catch (error) {
            console.error('Search users error:', error);
            res.status(500).json({ error: 'Search failed' });
        }
    },

    // Set disappearing messages for a chat
    async setDisappearingMessages(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { duration } = req.body;

            const validDurations = ['off', '24h', '7d', '90d'];
            if (!validDurations.includes(duration)) {
                res.status(400).json({ error: 'Invalid duration. Use: off, 24h, 7d, 90d' });
                return;
            }

            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            await Chat.updateOne(
                { _id: chatId },
                { $set: { disappearingMessages: duration } }
            );

            res.json({ message: `Disappearing messages set to ${duration}`, duration });
        } catch (error) {
            console.error('Set disappearing messages error:', error);
            res.status(500).json({ error: 'Failed to update disappearing messages setting' });
        }
    },

    // Toggle mute for a chat (with optional duration like WhatsApp)
    async muteChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { muted, duration } = req.body; // duration: '8h' | '1w' | '1y' | 'always' | null
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            let mutedUntil: Date | null = null;
            if (muted && duration && duration !== 'always') {
                const now = new Date();
                const durations: Record<string, number> = {
                    '8h': 8 * 60 * 60 * 1000,
                    '1w': 7 * 24 * 60 * 60 * 1000,
                    '1y': 365 * 24 * 60 * 60 * 1000,
                };
                const ms = durations[duration];
                if (ms) mutedUntil = new Date(now.getTime() + ms);
            }

            const updateFields: Record<string, unknown> = {
                'participants.$.muted': !!muted,
            };
            if (muted) {
                updateFields['participants.$.mutedUntil'] = mutedUntil; // null = indefinite
            } else {
                updateFields['participants.$.mutedUntil'] = null;
            }

            await Chat.updateOne(
                { _id: chatId, 'participants.user': userId },
                { $set: updateFields }
            );
            res.json({
                message: muted ? 'Chat muted' : 'Chat unmuted',
                muted: !!muted,
                mutedUntil,
                duration: muted ? (duration || 'always') : null,
            });
        } catch (error) {
            console.error('Mute chat error:', error);
            res.status(500).json({ error: 'Failed to update mute setting' });
        }
    },

    // Set chat wallpaper for current user
    async setChatWallpaper(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const { wallpaper } = req.body;
            
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { 
                res.status(404).json({ error: 'Chat not found' }); 
                return; 
            }

            await Chat.updateOne(
                { _id: chatId, 'participants.user': userId },
                { $set: { 'participants.$.wallpaper': wallpaper } }
            );
            
            res.json({
                message: 'Wallpaper updated',
                wallpaper,
            });
        } catch (error) {
            console.error('Set chat wallpaper error:', error);
            res.status(500).json({ error: 'Failed to update wallpaper' });
        }
    },

    // Get all muted chats for current user
    async getMutedChats(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const chats = await Chat.find({
                'participants': {
                    $elemMatch: { user: userId, muted: true }
                }
            })
                .populate('participants.user', 'name avatar status lastSeen email phone')
                .populate('lastMessage')
                .sort({ lastMessageAt: -1 });

            const now = new Date();
            const mutedChats = chats.map(chat => {
                const chatObj: any = chat.toObject();
                const myParticipant = chat.participants.find(
                    p => p.user._id?.toString() === userId || p.user.toString() === userId
                );
                return {
                    ...chatObj,
                    mutedUntil: myParticipant?.mutedUntil || null,
                    isMuteExpired: myParticipant?.mutedUntil ? myParticipant.mutedUntil < now : false,
                };
            });

            res.json({ chats: mutedChats });
        } catch (error) {
            console.error('Get muted chats error:', error);
            res.status(500).json({ error: 'Failed to get muted chats' });
        }
    },

    // Clear a single chat (soft-delete messages for current user)
    async clearChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            await Message.updateMany(
                { chat: chatId },
                { $addToSet: { deletedFor: userId } }
            );
            await Chat.updateOne({ _id: chatId }, { $unset: { lastMessage: 1 } });
            res.json({ message: 'Chat cleared' });
        } catch (error) {
            console.error('Clear chat error:', error);
            res.status(500).json({ error: 'Failed to clear chat' });
        }
    },

    // Delete a single chat for current user
    async deleteChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            // Soft-delete all messages for this user
            await Message.updateMany(
                { chat: chatId },
                { $addToSet: { deletedFor: userId } }
            );

            // Remove user from participants
            await Chat.updateOne(
                { _id: chatId },
                { $pull: { participants: { user: userId } } as any, $unset: { lastMessage: 1 } }
            );

            res.json({ message: 'Chat deleted' });
        } catch (error) {
            console.error('Delete chat error:', error);
            res.status(500).json({ error: 'Failed to delete chat' });
        }
    },

    // Archive all chats
    async archiveAll(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const now = new Date();
            // Update per-participant archive flag for all chats this user is in
            await Chat.updateMany(
                { 'participants.user': userId },
                { $addToSet: { archivedBy: userId }, $set: { 'participants.$[elem].isArchived': true, 'participants.$[elem].archivedAt': now } },
                { arrayFilters: [{ 'elem.user': new mongoose.Types.ObjectId(userId!) }] }
            );
            res.json({ message: 'All chats archived' });
        } catch (error) {
            console.error('Archive all error:', error);
            res.status(500).json({ error: 'Failed to archive chats' });
        }
    },

    // Archive a single chat
    async archiveChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            await Chat.updateOne(
                { _id: chatId, 'participants.user': userId },
                {
                    $addToSet: { archivedBy: userId },
                    $set: { 'participants.$.isArchived': true, 'participants.$.archivedAt': new Date() }
                }
            );
            res.json({ message: 'Chat archived', chatId });
        } catch (error) {
            console.error('Archive chat error:', error);
            res.status(500).json({ error: 'Failed to archive chat' });
        }
    },

    // Unarchive a single chat
    async unarchiveChat(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;
            const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
            if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }

            await Chat.updateOne(
                { _id: chatId, 'participants.user': userId },
                {
                    $pull: { archivedBy: userId },
                    $set: { 'participants.$.isArchived': false, 'participants.$.archivedAt': null }
                }
            );
            res.json({ message: 'Chat unarchived', chatId });
        } catch (error) {
            console.error('Unarchive chat error:', error);
            res.status(500).json({ error: 'Failed to unarchive chat' });
        }
    },

    // Bulk archive multiple chats
    async archiveChats(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatIds } = req.body;
            if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
                res.status(400).json({ error: 'chatIds array is required' }); return;
            }
            const now = new Date();
            await Chat.updateMany(
                { _id: { $in: chatIds }, 'participants.user': userId },
                { $addToSet: { archivedBy: userId }, $set: { 'participants.$[elem].isArchived': true, 'participants.$[elem].archivedAt': now } },
                { arrayFilters: [{ 'elem.user': new mongoose.Types.ObjectId(userId!) }] }
            );
            res.json({ message: `${chatIds.length} chats archived`, chatIds });
        } catch (error) {
            console.error('Bulk archive error:', error);
            res.status(500).json({ error: 'Failed to archive chats' });
        }
    },

    // List archived chats (with pagination)
    async listArchivedChats(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { limit = 50, before } = req.query;

            const requestingUser = await User.findById(userId).select('contacts');
            const contactIds = (requestingUser?.contacts || []).map(c => c.toString());

            const query: Record<string, unknown> = {
                'participants.user': userId,
                archivedBy: userId,
            };
            if (before) {
                query.lastMessageAt = { $lt: new Date(before as string) };
            }

            const chats = await Chat.find(query)
                .populate('participants.user', 'name avatar status lastSeen email phone bio settings')
                .populate('lastMessage')
                .populate('createdBy', 'name avatar')
                .sort({ lastMessageAt: -1 })
                .limit(parseInt(limit as string));

            const chatsWithUnread = await Promise.all(
                chats.map(async (chat) => {
                    const unreadCount = await Message.countDocuments({
                        chat: chat._id,
                        sender: { $ne: userId },
                        'readBy.user': { $ne: userId },
                        isDeleted: false,
                    });
                    const chatObj: any = chat.toObject();
                    chatObj.participants = chatObj.participants.map((p: any) => ({
                        ...p,
                        user: applyPrivacyFilter(p.user as Record<string, unknown>, userId!, contactIds),
                    }));
                    const myParticipant = chat.participants.find(
                        p => p.user._id?.toString() === userId || p.user.toString() === userId
                    );
                    chatObj.isPinned = myParticipant?.isPinned || false;
                    chatObj.pinnedAt = myParticipant?.pinnedAt;
                    chatObj.isArchived = true;
                    return { ...chatObj, unreadCount };
                })
            );
            res.json({ chats: chatsWithUnread });
        } catch (error) {
            console.error('List archived chats error:', error);
            res.status(500).json({ error: 'Failed to list archived chats' });
        }
    },

    // Update keepChatsArchived setting
    async updateKeepChatsArchived(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { keepChatsArchived } = req.body;
            if (typeof keepChatsArchived !== 'boolean') {
                res.status(400).json({ error: 'keepChatsArchived must be a boolean' }); return;
            }
            await User.findByIdAndUpdate(userId, { 'settings.keepChatsArchived': keepChatsArchived });
            res.json({ message: `keepChatsArchived set to ${keepChatsArchived}`, keepChatsArchived });
        } catch (error) {
            console.error('Update keepChatsArchived error:', error);
            res.status(500).json({ error: 'Failed to update setting' });
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

    // Get common groups between current user and another user
    async getCommonGroups(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { otherUserId } = req.params;

            if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }

            // Find all group chats where both users are participants
            const commonGroups = await Chat.find({
                type: 'group',
                'participants.user': { $all: [userId, otherUserId] },
            })
                .populate('participants.user', 'name avatar email status lastSeen bio')
                .populate('lastMessage')
                .sort({ lastMessageAt: -1 })
                .lean();

            res.json({ groups: commonGroups });
        } catch (error) {
            console.error('Get common groups error:', error);
            res.status(500).json({ error: 'Failed to get common groups' });
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
