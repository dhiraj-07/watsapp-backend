import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User, Chat, Message, IMessage, Call } from '../models';
import mongoose from 'mongoose';
import {
    sendNotification,
    sendNotificationToMany,
    buildMessageNotification,
    buildReactionNotification,
    buildIncomingCallNotification,
    buildMissedCallNotification,
    buildGroupNotification,
    buildPollNotification,
} from '../services/notification.service';

interface SocketUser {
    odId: string;
    email: string;
}

interface AuthenticatedSocket extends Socket {
    user?: SocketUser;
}

// Store online users
const onlineUsers = new Map<string, Set<string>>(); // odId -> Set<socketId>

// Track active calls: "callerId:recipientId" -> callId
const activeCallsMap = new Map<string, string>();

export const initializeSocket = (io: Server): void => {
    // Authentication middleware
    io.use(async (socket: AuthenticatedSocket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;

            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token as string, config.jwtSecret) as { userId: string; email: string };
            socket.user = { odId: decoded.userId, email: decoded.email };
            next();
        } catch {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket: AuthenticatedSocket) => {
        const userId = socket.user?.odId;

        if (!userId) {
            socket.disconnect();
            return;
        }

        console.log(`🔌 User connected: ${userId} (${socket.id})`);

        // Add to online users
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }
        onlineUsers.get(userId)!.add(socket.id);

        // Update user status
        await User.findByIdAndUpdate(userId, { status: 'online' });

        // Join user's chat rooms
        const userChats = await Chat.find({ 'participants.user': userId });
        userChats.forEach(chat => {
            socket.join(`chat:${chat._id}`);
        });

        // Auto-deliver undelivered messages when user comes online
        try {
            const chatIds = userChats.map(c => c._id);
            const undeliveredMessages = await Message.find({
                chat: { $in: chatIds },
                sender: { $ne: userId },
                'deliveredTo.user': { $ne: userId },
                isDeleted: false,
            });

            if (undeliveredMessages.length > 0) {
                const now = new Date();
                await Message.updateMany(
                    {
                        _id: { $in: undeliveredMessages.map(m => m._id) },
                        'deliveredTo.user': { $ne: userId },
                    },
                    {
                        $addToSet: {
                            deliveredTo: { user: userId, deliveredAt: now },
                        },
                    }
                );

                // Group by chat and notify senders
                const byChatId = new Map<string, string[]>();
                for (const msg of undeliveredMessages) {
                    const cid = msg.chat.toString();
                    if (!byChatId.has(cid)) byChatId.set(cid, []);
                    byChatId.get(cid)!.push(msg._id.toString());
                }

                for (const [chatId, messageIds] of byChatId) {
                    io.to(`chat:${chatId}`).emit('message:deliveryUpdate', {
                        chatId,
                        messageIds,
                        deliveredTo: { user: userId, deliveredAt: now },
                    });
                }
            }
        } catch (error) {
            console.error('Auto-deliver on connect error:', error);
        }

        // Broadcast online status (respecting privacy settings)
        try {
            const currentUser = await User.findById(userId).select('settings contacts');
            const visibility = currentUser?.settings?.lastSeenVisibility || 'everyone';

            if (visibility === 'everyone') {
                socket.broadcast.emit('user:online', { userId });
            } else if (visibility === 'contacts') {
                // Only emit to contacts
                const contactIds = (currentUser?.contacts || []).map(c => c.toString());
                for (const [uid, socketIds] of onlineUsers.entries()) {
                    if (contactIds.includes(uid)) {
                        for (const sid of socketIds) {
                            io.to(sid).emit('user:online', { userId });
                        }
                    }
                }
            }
            // visibility === 'nobody' → don't broadcast at all
        } catch (error) {
            console.error('Privacy-filtered online broadcast error:', error);
        }

        // ============ MESSAGE EVENTS ============

        // Send message
        socket.on('message:send', async (data: {
            chatId: string;
            content: string;
            messageType: string;
            media?: object;
            poll?: { question: string; options: string[]; allowMultiple: boolean };
            replyTo?: string;
        }, callback) => {
            try {
                const { chatId, content, messageType, media, poll, replyTo } = data;

                // Verify user is in chat
                const chat = await Chat.findOne({
                    _id: chatId,
                    'participants.user': userId,
                });

                if (!chat) {
                    callback?.({ error: 'Chat not found' });
                    return;
                }

                // Auto-join all online participants to the chat room
                // (handles newly created chats where recipients haven't joined yet)
                for (const p of chat.participants) {
                    const pid = p.user.toString();
                    const pSocketIds = onlineUsers.get(pid);
                    if (pSocketIds) {
                        for (const sid of pSocketIds) {
                            const s = io.sockets.sockets.get(sid);
                            if (s && !s.rooms.has(`chat:${chatId}`)) {
                                s.join(`chat:${chatId}`);
                            }
                        }
                    }
                }

                // Create message
                const message = new Message({
                    chat: chatId,
                    sender: userId,
                    content,
                    messageType: messageType || 'text',
                    media,
                    poll: poll ? {
                        question: poll.question,
                        options: poll.options.map(text => ({ text, votes: [] })),
                        allowMultiple: poll.allowMultiple || false,
                    } : undefined,
                    replyTo,
                    deliveredTo: [],
                    readBy: [],
                });

                // Set expiresAt based on chat's disappearingMessages setting
                if (chat.disappearingMessages && chat.disappearingMessages !== 'off') {
                    const now = new Date();
                    const durations: Record<string, number> = {
                        '24h': 24 * 60 * 60 * 1000,
                        '7d': 7 * 24 * 60 * 60 * 1000,
                        '90d': 90 * 24 * 60 * 60 * 1000,
                    };
                    const ms = durations[chat.disappearingMessages];
                    if (ms) {
                        message.expiresAt = new Date(now.getTime() + ms);
                    }
                }


                await message.save();
                await message.populate('sender', 'name avatar');
                if (replyTo) {
                    await message.populate({
                        path: 'replyTo',
                        populate: { path: 'sender', select: 'name avatar' }
                    });
                }

                // Update chat's last message
                await Chat.findByIdAndUpdate(chatId, {
                    lastMessage: message._id,
                    lastMessageAt: new Date(),
                });

                // Emit to all participants in chat
                io.to(`chat:${chatId}`).emit('message:new', {
                    message: message.toObject(),
                    chatId,
                });

                // Emit delivery receipt for sender
                callback?.({ success: true, message: message.toObject() });

                // Auto-deliver to online participants
                const onlineParticipants = chat.participants
                    .filter(p => p.user.toString() !== userId && onlineUsers.has(p.user.toString()));

                if (onlineParticipants.length > 0) {
                    const now = new Date();
                    const deliveryEntries = onlineParticipants.map(p => ({
                        user: p.user,
                        deliveredAt: now,
                    }));

                    await Message.findByIdAndUpdate(message._id, {
                        $addToSet: {
                            deliveredTo: { $each: deliveryEntries },
                        },
                    });

                    // Notify about delivery
                    io.to(`chat:${chatId}`).emit('message:deliveryUpdate', {
                        chatId,
                        messageIds: [message._id.toString()],
                        deliveredTo: deliveryEntries,
                    });
                }

                // Send push notifications to offline users
                const senderObj = message.toObject().sender;
                const senderName = senderObj?.name || 'Someone';
                const chatName = chat.type === 'group' ? chat.name : undefined;
                const isGroup = chat.type === 'group';
                const imageUrl = message.messageType === 'image' && message.media?.url
                    ? message.media.url : undefined;

                const offlineParticipantIds = chat.participants
                    .filter(p => p.user.toString() !== userId && !onlineUsers.has(p.user.toString()))
                    .map(p => p.user.toString());

                if (offlineParticipantIds.length > 0) {
                    const notif = buildMessageNotification(
                        senderName,
                        content || '',
                        messageType || 'text',
                        chatId,
                        chatName,
                        isGroup,
                        imageUrl
                    );
                    notif.data.senderId = userId;
                    sendNotificationToMany(offlineParticipantIds, notif).catch(err =>
                        console.error('FCM message notification error:', err)
                    );
                }
            } catch (error) {
                console.error('Send message error:', error);
                callback?.({ error: 'Failed to send message' });
            }
        });

        // Forward messages to other chats
        socket.on('message:forward', async (data: {
            messageIds: string[];
            targetChatIds: string[];
        }, callback) => {
            try {
                const { messageIds, targetChatIds } = data;

                // Get original messages
                const originalMessages = await Message.find({ _id: { $in: messageIds } });
                if (originalMessages.length === 0) {
                    callback?.({ error: 'Messages not found' });
                    return;
                }

                const forwarded: any[] = [];

                for (const targetChatId of targetChatIds) {
                    // Verify user is in the target chat
                    const targetChat = await Chat.findOne({
                        _id: targetChatId,
                        'participants.user': userId,
                    });
                    if (!targetChat) continue;

                    // Auto-join all online participants to the target chat room
                    for (const p of targetChat.participants) {
                        const pid = p.user.toString();
                        const pSocketIds = onlineUsers.get(pid);
                        if (pSocketIds) {
                            for (const sid of pSocketIds) {
                                const s = io.sockets.sockets.get(sid);
                                if (s && !s.rooms.has(`chat:${targetChatId}`)) {
                                    s.join(`chat:${targetChatId}`);
                                }
                            }
                        }
                    }

                    for (const orig of originalMessages) {
                        const newMsg = new Message({
                            chat: targetChatId,
                            sender: userId,
                            content: orig.content,
                            messageType: orig.messageType,
                            media: orig.media,
                            poll: orig.poll ? {
                                question: orig.poll.question,
                                options: orig.poll.options.map((o: any) => ({ text: o.text, votes: [] })),
                                allowMultiple: orig.poll.allowMultiple,
                            } : undefined,
                            forwardedFrom: orig._id,
                            deliveredTo: [],
                            readBy: [],
                        });

                        await newMsg.save();
                        await newMsg.populate('sender', 'name avatar');

                        // Update target chat last message
                        await Chat.findByIdAndUpdate(targetChatId, {
                            lastMessage: newMsg._id,
                            lastMessageAt: new Date(),
                        });

                        // Emit to target chat
                        io.to(`chat:${targetChatId}`).emit('message:new', {
                            message: newMsg.toObject(),
                            chatId: targetChatId,
                        });

                        forwarded.push(newMsg.toObject());
                    }
                }

                callback?.({ success: true, forwarded });
            } catch (error) {
                console.error('Forward message error:', error);
                callback?.({ error: 'Failed to forward messages' });
            }
        });

        // Message delivered — only mark messages from OTHER senders as delivered
        socket.on('message:delivered', async (data: { messageId: string; chatId?: string }) => {
            try {
                // Prevent sender from marking their own message as delivered
                const message = await Message.findOneAndUpdate(
                    {
                        _id: data.messageId,
                        sender: { $ne: userId },
                        'deliveredTo.user': { $ne: userId },
                    },
                    {
                        $addToSet: {
                            deliveredTo: { user: userId, deliveredAt: new Date() },
                        },
                    },
                    { new: true }
                );

                if (message) {
                    io.to(`chat:${message.chat}`).emit('message:deliveryUpdate', {
                        chatId: message.chat.toString(),
                        messageIds: [data.messageId],
                        deliveredTo: [{ user: userId, deliveredAt: new Date() }],
                    });
                }
            } catch (error) {
                console.error('Delivery update error:', error);
            }
        });

        // Message read — WhatsApp-like read receipt logic:
        // 1. Only mark messages from OTHER senders as read (never your own).
        // 2. Only emit readUpdate for messages that were actually eligible.
        // 3. Respect the reader's readReceipts privacy setting.
        // 4. Reading implies delivery, so also mark as delivered if not already.
        socket.on('message:read', async (data: { chatId: string; messageIds: string[] }) => {
            try {
                const { chatId, messageIds } = data;
                if (!messageIds || messageIds.length === 0) return;

                // Find messages that can actually be marked as read:
                // - In the specified chat
                // - NOT sent by the current user (can't "read" your own messages)
                // - NOT already read by the current user
                const eligibleMessages = await Message.find({
                    _id: { $in: messageIds },
                    chat: chatId,
                    sender: { $ne: userId },
                    'readBy.user': { $ne: userId },
                    isDeleted: false,
                }).select('_id');

                if (eligibleMessages.length === 0) return;

                const eligibleIds = eligibleMessages.map(m => m._id);
                const now = new Date();

                // Update DB — mark eligible messages as read
                await Message.updateMany(
                    { _id: { $in: eligibleIds } },
                    {
                        $addToSet: {
                            readBy: { user: userId, readAt: now },
                        },
                    }
                );

                // Read implies delivered — also mark as delivered if not already
                await Message.updateMany(
                    {
                        _id: { $in: eligibleIds },
                        'deliveredTo.user': { $ne: userId },
                    },
                    {
                        $addToSet: {
                            deliveredTo: { user: userId, deliveredAt: now },
                        },
                    }
                );

                // Check reader's readReceipts privacy setting before broadcasting
                const reader = await User.findById(userId).select('settings').lean();
                const readReceiptsEnabled = reader?.settings?.readReceipts !== false;

                if (readReceiptsEnabled) {
                    io.to(`chat:${chatId}`).emit('message:readUpdate', {
                        chatId,
                        messageIds: eligibleIds.map(id => id.toString()),
                        readBy: { user: userId, readAt: now },
                    });
                }
            } catch (error) {
                console.error('Read update error:', error);
            }
        });

        // ============ TYPING EVENTS ============

        socket.on('typing:start', (data: { chatId: string }) => {
            socket.to(`chat:${data.chatId}`).emit('typing:update', {
                chatId: data.chatId,
                userId: userId,
                isTyping: true,
            });
        });

        socket.on('typing:stop', (data: { chatId: string }) => {
            socket.to(`chat:${data.chatId}`).emit('typing:update', {
                chatId: data.chatId,
                userId: userId,
                isTyping: false,
            });
        });

        // ============ REACTION EVENTS ============

        socket.on('message:react', async (data: { messageId: string; emoji: string }) => {
            try {
                const message = await Message.findById(data.messageId);
                if (!message) return;

                // Remove existing reaction from this user
                message.reactions = message.reactions.filter(
                    r => r.user.toString() !== userId
                );

                // Add new reaction if emoji provided
                if (data.emoji) {
                    message.reactions.push({
                        user: new mongoose.Types.ObjectId(userId),
                        emoji: data.emoji,
                        timestamp: new Date(),
                    });
                }

                await message.save();

                io.to(`chat:${message.chat}`).emit('message:reactionUpdate', {
                    messageId: data.messageId,
                    reactions: message.reactions,
                });

                // Push notification for reaction to message sender (if not self)
                const msgSenderId = message.sender.toString();
                if (msgSenderId !== userId && data.emoji) {
                    const reactor = await User.findById(userId).select('name').lean();
                    const reactorName = reactor?.name || 'Someone';
                    const notif = buildReactionNotification(
                        reactorName,
                        data.emoji,
                        message.chat.toString(),
                        message.content || ''
                    );
                    sendNotification(msgSenderId, notif).catch(err =>
                        console.error('FCM reaction notification error:', err)
                    );
                }
            } catch (error) {
                console.error('Reaction error:', error);
            }
        });

        // ============ MESSAGE DELETE EVENTS ============

        // Delete message for me only
        socket.on('message:deleteForMe', async (data: { messageId: string }, callback) => {
            try {
                const message = await Message.findById(data.messageId);
                if (!message) {
                    callback?.({ error: 'Message not found' });
                    return;
                }

                // Add user to deletedFor array
                await Message.findByIdAndUpdate(data.messageId, {
                    $addToSet: { deletedFor: userId },
                });

                // Emit only to the user who deleted
                socket.emit('message:deleted', {
                    messageId: data.messageId,
                    deletedFor: 'me',
                });

                callback?.({ success: true });
            } catch (error) {
                console.error('Delete for me error:', error);
                callback?.({ error: 'Failed to delete message' });
            }
        });

        // Delete message for everyone
        socket.on('message:deleteForEveryone', async (data: { messageId: string }, callback) => {
            try {
                const message = await Message.findById(data.messageId);
                if (!message) {
                    callback?.({ error: 'Message not found' });
                    return;
                }

                // Only the sender can delete for everyone
                if (message.sender.toString() !== userId) {
                    callback?.({ error: 'Only the sender can delete for everyone' });
                    return;
                }

                // Update message as deleted
                await Message.findByIdAndUpdate(data.messageId, {
                    isDeleted: true,
                    content: '',
                    media: undefined,
                });

                // Emit to all participants in the chat
                io.to(`chat:${message.chat}`).emit('message:deletedForEveryone', {
                    messageId: data.messageId,
                    chatId: message.chat.toString(),
                });

                callback?.({ success: true });
            } catch (error) {
                console.error('Delete for everyone error:', error);
                callback?.({ error: 'Failed to delete message' });
            }
        });

        // ============ MESSAGE PIN EVENTS ============

        // Pin a message
        socket.on('message:pin', async (data: { messageId: string }, callback) => {
            try {
                const message = await Message.findById(data.messageId);
                if (!message) {
                    callback?.({ error: 'Message not found' });
                    return;
                }

                // Update message as pinned
                const updatedMessage = await Message.findByIdAndUpdate(
                    data.messageId,
                    {
                        isPinned: true,
                        pinnedAt: new Date(),
                        pinnedBy: userId,
                    },
                    { new: true }
                ).populate('sender', 'name avatar').populate('pinnedBy', 'name');

                // Emit to all participants in the chat
                io.to(`chat:${message.chat}`).emit('message:pinned', {
                    message: updatedMessage?.toObject(),
                    chatId: message.chat.toString(),
                });

                callback?.({ success: true, message: updatedMessage?.toObject() });
            } catch (error) {
                console.error('Pin message error:', error);
                callback?.({ error: 'Failed to pin message' });
            }
        });

        // Unpin a message
        socket.on('message:unpin', async (data: { messageId: string }, callback) => {
            try {
                const message = await Message.findById(data.messageId);
                if (!message) {
                    callback?.({ error: 'Message not found' });
                    return;
                }

                // Update message as unpinned
                await Message.findByIdAndUpdate(data.messageId, {
                    isPinned: false,
                    pinnedAt: undefined,
                    pinnedBy: undefined,
                });

                // Emit to all participants in the chat
                io.to(`chat:${message.chat}`).emit('message:unpinned', {
                    messageId: data.messageId,
                    chatId: message.chat.toString(),
                });

                callback?.({ success: true });
            } catch (error) {
                console.error('Unpin message error:', error);
                callback?.({ error: 'Failed to unpin message' });
            }
        });

        // ============ POLL EVENTS ============

        // Vote on a poll
        socket.on('poll:vote', async (data: { messageId: string; optionIndex: number }, callback) => {
            try {
                const message = await Message.findById(data.messageId);

                if (!message || message.messageType !== 'poll' || !message.poll) {
                    callback?.({ error: 'Poll not found' });
                    return;
                }

                // Verify user is in the chat
                const chat = await Chat.findOne({
                    _id: message.chat,
                    'participants.user': userId,
                });

                if (!chat) {
                    callback?.({ error: 'Not authorized' });
                    return;
                }

                const userObjectId = new mongoose.Types.ObjectId(userId);
                const optionIndex = data.optionIndex;

                if (optionIndex < 0 || optionIndex >= message.poll.options.length) {
                    callback?.({ error: 'Invalid option' });
                    return;
                }

                // Check if user already voted (for single-vote polls)
                if (!message.poll.allowMultiple) {
                    // Remove user's previous vote from all options
                    message.poll.options.forEach(option => {
                        option.votes = option.votes.filter(
                            v => v.toString() !== userId
                        );
                    });
                } else {
                    // For multiple votes, toggle the vote on this option
                    const currentOption = message.poll.options[optionIndex];
                    const hasVoted = currentOption.votes.some(v => v.toString() === userId);
                    if (hasVoted) {
                        // Remove vote
                        currentOption.votes = currentOption.votes.filter(
                            v => v.toString() !== userId
                        );
                        await message.save();

                        io.to(`chat:${message.chat}`).emit('poll:updated', {
                            messageId: data.messageId,
                            poll: message.poll,
                            chatId: message.chat.toString(),
                        });

                        callback?.({ success: true, poll: message.poll });
                        return;
                    }
                }

                // Add vote to selected option
                message.poll.options[optionIndex].votes.push(userObjectId);
                await message.save();

                // Broadcast poll update to all participants
                io.to(`chat:${message.chat}`).emit('poll:updated', {
                    messageId: data.messageId,
                    poll: message.poll,
                    chatId: message.chat.toString(),
                });

                callback?.({ success: true, poll: message.poll });
            } catch (error) {
                console.error('Poll vote error:', error);
                callback?.({ error: 'Failed to vote' });
            }
        });

        // ============ CHAT EVENTS ============

        socket.on('chat:join', (data: { chatId: string }) => {
            socket.join(`chat:${data.chatId}`);
        });

        socket.on('chat:leave', (data: { chatId: string }) => {
            socket.leave(`chat:${data.chatId}`);
        });

        // Pin a chat (max 3 pinned chats per user)
        socket.on('chat:pin', async (data: { chatId: string }, callback) => {
            try {
                // First, check how many chats are already pinned by this user
                const pinnedCount = await Chat.countDocuments({
                    'participants.user': userId,
                    'participants': {
                        $elemMatch: {
                            user: userId,
                            isPinned: true,
                        },
                    },
                });

                if (pinnedCount >= 3) {
                    callback?.({ error: 'You can only pin up to 3 chats' });
                    return;
                }

                // Find chat and verify user is participant
                const chat = await Chat.findOne({
                    _id: data.chatId,
                    'participants.user': userId,
                });

                if (!chat) {
                    callback?.({ error: 'Chat not found' });
                    return;
                }

                // Update the user's participant record
                const now = new Date();
                await Chat.updateOne(
                    { _id: data.chatId, 'participants.user': userId },
                    {
                        $set: {
                            'participants.$.isPinned': true,
                            'participants.$.pinnedAt': now,
                        },
                    }
                );

                // Emit only to the user's sockets
                const userSocketIds = onlineUsers.get(userId);
                if (userSocketIds) {
                    userSocketIds.forEach(sid => {
                        io.to(sid).emit('chat:pinned', {
                            chatId: data.chatId,
                            pinnedAt: now,
                        });
                    });
                }

                callback?.({ success: true, pinnedAt: now });
            } catch (error) {
                console.error('Pin chat error:', error);
                callback?.({ error: 'Failed to pin chat' });
            }
        });

        // Unpin a chat
        socket.on('chat:unpin', async (data: { chatId: string }, callback) => {
            try {
                // Find chat and verify user is participant
                const chat = await Chat.findOne({
                    _id: data.chatId,
                    'participants.user': userId,
                });

                if (!chat) {
                    callback?.({ error: 'Chat not found' });
                    return;
                }

                // Update the user's participant record
                await Chat.updateOne(
                    { _id: data.chatId, 'participants.user': userId },
                    {
                        $set: {
                            'participants.$.isPinned': false,
                            'participants.$.pinnedAt': null,
                        },
                    }
                );

                // Emit only to the user's sockets
                const userSocketIds = onlineUsers.get(userId);
                if (userSocketIds) {
                    userSocketIds.forEach(sid => {
                        io.to(sid).emit('chat:unpinned', {
                            chatId: data.chatId,
                        });
                    });
                }

                callback?.({ success: true });
            } catch (error) {
                console.error('Unpin chat error:', error);
                callback?.({ error: 'Failed to unpin chat' });
            }
        });

        // ============ GROUP ADMIN EVENTS ============

        // Add members to group (admin only)
        socket.on('group:addMembers', async (data: { chatId: string; userIds: string[] }, callback) => {
            try {
                const chat = await Chat.findOne({
                    _id: data.chatId,
                    type: 'group',
                });
                if (!chat) { callback?.({ error: 'Group not found' }); return; }

                const requester = chat.participants.find(p => p.user.toString() === userId);
                if (!requester || requester.role !== 'admin') {
                    callback?.({ error: 'Only admins can add members' }); return;
                }

                const newMembers = data.userIds.filter(
                    uid => !chat.participants.some(p => p.user.toString() === uid)
                );
                for (const uid of newMembers) {
                    chat.participants.push({
                        user: new mongoose.Types.ObjectId(uid),
                        role: 'member',
                        joinedAt: new Date(),
                        muted: false,
                    } as any);
                }
                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen email phone bio');

                io.to(`chat:${data.chatId}`).emit('group:updated', {
                    chatId: data.chatId,
                    chat: chat.toObject(),
                });

                // Have new members join the socket room
                for (const uid of newMembers) {
                    const userSocketIds = onlineUsers.get(uid);
                    if (userSocketIds) {
                        userSocketIds.forEach(sid => {
                            io.sockets.sockets.get(sid)?.join(`chat:${data.chatId}`);
                        });
                    }
                }

                callback?.({ success: true, chat: chat.toObject() });

                // FCM: Notify new members they were added
                if (newMembers.length > 0) {
                    const actor = await User.findById(userId).select('name').lean();
                    const actorName = actor?.name || 'Someone';
                    const groupName = chat.name || 'a group';
                    const notif = buildGroupNotification(data.chatId, groupName, 'member_added', actorName, 'you');
                    sendNotificationToMany(newMembers, notif).catch(() => { });
                }
            } catch (error) {
                console.error('Group add members error:', error);
                callback?.({ error: 'Failed to add members' });
            }
        });

        // Remove member from group (admin only, cannot remove creator)
        socket.on('group:removeMember', async (data: { chatId: string; targetUserId: string }, callback) => {
            try {
                const chat = await Chat.findOne({ _id: data.chatId, type: 'group' });
                if (!chat) { callback?.({ error: 'Group not found' }); return; }

                const requester = chat.participants.find(p => p.user.toString() === userId);
                if (!requester || requester.role !== 'admin') {
                    callback?.({ error: 'Only admins can remove members' }); return;
                }
                if (chat.createdBy.toString() === data.targetUserId) {
                    callback?.({ error: 'Cannot remove the group creator' }); return;
                }

                chat.participants = chat.participants.filter(
                    p => p.user.toString() !== data.targetUserId
                );
                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen email phone bio');

                io.to(`chat:${data.chatId}`).emit('group:updated', {
                    chatId: data.chatId,
                    chat: chat.toObject(),
                });

                // Remove target user from socket room
                const targetSockets = onlineUsers.get(data.targetUserId);
                if (targetSockets) {
                    targetSockets.forEach(sid => {
                        io.sockets.sockets.get(sid)?.leave(`chat:${data.chatId}`);
                    });
                }

                callback?.({ success: true, chat: chat.toObject() });

                // FCM: Notify removed member
                const actor = await User.findById(userId).select('name').lean();
                const actorName = actor?.name || 'An admin';
                const groupName = chat.name || 'a group';
                const notif = buildGroupNotification(data.chatId, groupName, 'member_removed', actorName, 'you');
                sendNotification(data.targetUserId, notif).catch(() => { });
            } catch (error) {
                console.error('Group remove member error:', error);
                callback?.({ error: 'Failed to remove member' });
            }
        });

        // Make admin (admin only)
        socket.on('group:makeAdmin', async (data: { chatId: string; targetUserId: string }, callback) => {
            try {
                const chat = await Chat.findOne({ _id: data.chatId, type: 'group' });
                if (!chat) { callback?.({ error: 'Group not found' }); return; }

                const requester = chat.participants.find(p => p.user.toString() === userId);
                if (!requester || requester.role !== 'admin') {
                    callback?.({ error: 'Only admins can promote members' }); return;
                }

                const target = chat.participants.find(p => p.user.toString() === data.targetUserId);
                if (!target) { callback?.({ error: 'User not in group' }); return; }

                target.role = 'admin';
                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen email phone bio');

                io.to(`chat:${data.chatId}`).emit('group:updated', {
                    chatId: data.chatId,
                    chat: chat.toObject(),
                });

                callback?.({ success: true, chat: chat.toObject() });

                // FCM: Notify promoted user
                const groupName = chat.name || 'a group';
                const notif = buildGroupNotification(data.chatId, groupName, 'admin_promoted', '', 'You');
                sendNotification(data.targetUserId, notif).catch(() => { });
            } catch (error) {
                console.error('Group make admin error:', error);
                callback?.({ error: 'Failed to make admin' });
            }
        });

        // Remove admin (admin only, cannot demote creator)
        socket.on('group:removeAdmin', async (data: { chatId: string; targetUserId: string }, callback) => {
            try {
                const chat = await Chat.findOne({ _id: data.chatId, type: 'group' });
                if (!chat) { callback?.({ error: 'Group not found' }); return; }

                const requester = chat.participants.find(p => p.user.toString() === userId);
                if (!requester || requester.role !== 'admin') {
                    callback?.({ error: 'Only admins can demote admins' }); return;
                }
                if (chat.createdBy.toString() === data.targetUserId) {
                    callback?.({ error: 'Cannot remove admin from the group creator' }); return;
                }

                const target = chat.participants.find(p => p.user.toString() === data.targetUserId);
                if (!target) { callback?.({ error: 'User not in group' }); return; }

                target.role = 'member';
                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen email phone bio');

                io.to(`chat:${data.chatId}`).emit('group:updated', {
                    chatId: data.chatId,
                    chat: chat.toObject(),
                });

                callback?.({ success: true, chat: chat.toObject() });

                // FCM: Notify demoted user
                const groupName2 = chat.name || 'a group';
                const notif2 = buildGroupNotification(data.chatId, groupName2, 'admin_demoted', '', 'You');
                sendNotification(data.targetUserId, notif2).catch(() => { });
            } catch (error) {
                console.error('Group remove admin error:', error);
                callback?.({ error: 'Failed to remove admin' });
            }
        });

        // Leave group via socket
        socket.on('group:leave', async (data: { chatId: string }, callback) => {
            try {
                const chat = await Chat.findOne({ _id: data.chatId, type: 'group', 'participants.user': userId });
                if (!chat) { callback?.({ error: 'Group not found' }); return; }

                // Creator can always leave, but if they are last admin we auto-promote
                chat.participants = chat.participants.filter(p => p.user.toString() !== userId);

                if (chat.participants.length === 0) {
                    await Chat.findByIdAndDelete(data.chatId);
                    callback?.({ success: true, deleted: true });
                    return;
                }

                // If no admins left, promote first participant
                const hasAdmin = chat.participants.some(p => p.role === 'admin');
                if (!hasAdmin && chat.participants.length > 0) {
                    chat.participants[0].role = 'admin';
                }

                await chat.save();
                await chat.populate('participants.user', 'name avatar status lastSeen email phone bio');

                socket.leave(`chat:${data.chatId}`);

                io.to(`chat:${data.chatId}`).emit('group:updated', {
                    chatId: data.chatId,
                    chat: chat.toObject(),
                });

                callback?.({ success: true });
            } catch (error) {
                console.error('Group leave error:', error);
                callback?.({ error: 'Failed to leave group' });
            }
        });

        // ============ CALL EVENTS ============

        socket.on('call:initiate', async (data: { recipientIds: string[]; type: 'audio' | 'video'; chatId?: string }, callback?: (res: { callId?: string; error?: string }) => void) => {
            try {
                const caller = await User.findById(userId).select('name avatar');
                const callerName = caller?.name || 'Someone';

                // Find or determine chat for this call
                let chatId = data.chatId;
                if (!chatId && data.recipientIds.length === 1) {
                    const chat = await Chat.findOne({
                        type: 'private',
                        'participants.user': { $all: [userId, data.recipientIds[0]] },
                    }).select('_id');
                    chatId = chat?._id?.toString();
                }

                // Create Call document
                const call = await Call.create({
                    type: data.type,
                    initiator: userId,
                    participants: data.recipientIds.map(id => ({ user: id, status: 'pending' })),
                    status: 'ringing',
                    chat: chatId || undefined,
                });

                const callId = call._id.toString();

                data.recipientIds.forEach(recipientId => {
                    activeCallsMap.set(`${userId}:${recipientId}`, callId);

                    const recipientSockets = onlineUsers.get(recipientId);
                    if (recipientSockets) {
                        recipientSockets.forEach(socketId => {
                            io.to(socketId).emit('call:incoming', {
                                callerId: userId,
                                caller,
                                type: data.type,
                                callId,
                                chatId,
                            });
                        });
                    }

                    // FCM push
                    const notif = buildIncomingCallNotification(callerName, data.type, userId);
                    sendNotification(recipientId, notif).catch(err =>
                        console.error('FCM call notification error:', err)
                    );
                });

                callback?.({ callId });
            } catch (error) {
                console.error('Call initiate error:', error);
                callback?.({ error: 'Failed to initiate call' });
            }
        });

        socket.on('call:accept', async (data: { callerId: string; callId?: string }) => {
            try {
                const callerSockets = onlineUsers.get(data.callerId);
                if (callerSockets) {
                    callerSockets.forEach(socketId => {
                        io.to(socketId).emit('call:accepted', { userId });
                    });
                }

                // Update Call document
                const callId = data.callId || activeCallsMap.get(`${data.callerId}:${userId}`);
                if (callId) {
                    await Call.findByIdAndUpdate(callId, {
                        $set: {
                            status: 'ongoing',
                            startedAt: new Date(),
                            'participants.$[elem].status': 'accepted',
                            'participants.$[elem].joinedAt': new Date(),
                        },
                    }, { arrayFilters: [{ 'elem.user': new mongoose.Types.ObjectId(userId) }] });
                }
            } catch (error) {
                console.error('Call accept error:', error);
            }
        });

        socket.on('call:reject', async (data: { callerId: string; callId?: string }) => {
            try {
                const callerSockets = onlineUsers.get(data.callerId);
                if (callerSockets) {
                    callerSockets.forEach(socketId => {
                        io.to(socketId).emit('call:rejected', { userId });
                    });
                }

                // Update Call to ended + create declined call message in chat
                const callId = data.callId || activeCallsMap.get(`${data.callerId}:${userId}`);
                if (callId) {
                    const call = await Call.findByIdAndUpdate(callId, {
                        $set: {
                            status: 'ended',
                            endedAt: new Date(),
                            'participants.$[elem].status': 'rejected',
                        },
                    }, { arrayFilters: [{ 'elem.user': new mongoose.Types.ObjectId(userId) }], new: true });

                    // Create declined call message in chat
                    if (call?.chat) {
                        const callMsg = await Message.create({
                            chat: call.chat,
                            sender: data.callerId,
                            content: JSON.stringify({ callType: call.type, status: 'declined', callId }),
                            messageType: 'call',
                        });
                        await callMsg.populate('sender', 'name avatar email phone');
                        await Chat.findByIdAndUpdate(call.chat, { lastMessage: callMsg._id, lastMessageAt: new Date() });
                        io.to(`chat:${call.chat.toString()}`).emit('message:new', { message: callMsg.toObject(), chatId: call.chat.toString() });
                    }

                    activeCallsMap.delete(`${data.callerId}:${userId}`);
                }

                // Missed call notification
                User.findById(userId).select('name').lean().then(rejecter => {
                    const rejecterName = rejecter?.name || 'Someone';
                    const notif = buildMissedCallNotification(rejecterName, 'audio', userId);
                    sendNotification(data.callerId, notif).catch(() => { });
                });
            } catch (error) {
                console.error('Call reject error:', error);
            }
        });

        socket.on('call:end', async (data: { recipientIds: string[]; callId?: string }) => {
            try {
                data.recipientIds.forEach(recipientId => {
                    const recipientSockets = onlineUsers.get(recipientId);
                    if (recipientSockets) {
                        recipientSockets.forEach(socketId => {
                            io.to(socketId).emit('call:ended', { userId });
                        });
                    }
                });

                // Update Call document + create call message
                let callId = data.callId;
                if (!callId && data.recipientIds.length > 0) {
                    callId = activeCallsMap.get(`${userId}:${data.recipientIds[0]}`)
                        || activeCallsMap.get(`${data.recipientIds[0]}:${userId}`);
                }

                if (callId) {
                    const call = await Call.findById(callId);
                    if (call) {
                        const wasConnected = call.status === 'ongoing';
                        call.status = 'ended';
                        call.endedAt = new Date();
                        if (call.startedAt) {
                            call.duration = Math.floor((call.endedAt.getTime() - call.startedAt.getTime()) / 1000);
                        }
                        const participant = call.participants.find(p => p.user.toString() === userId);
                        if (participant) participant.leftAt = new Date();
                        await call.save();

                        // Create call message in chat
                        if (call.chat) {
                            const status = wasConnected ? 'ended' : 'missed';
                            const callMsg = await Message.create({
                                chat: call.chat,
                                sender: call.initiator,
                                content: JSON.stringify({
                                    callType: call.type,
                                    status,
                                    duration: call.duration || 0,
                                    callId,
                                }),
                                messageType: 'call',
                            });
                            await callMsg.populate('sender', 'name avatar email phone');
                            await Chat.findByIdAndUpdate(call.chat, { lastMessage: callMsg._id, lastMessageAt: new Date() });
                            io.to(`chat:${call.chat.toString()}`).emit('message:new', { message: callMsg.toObject(), chatId: call.chat.toString() });
                        }
                    }

                    // Clean up active calls map
                    data.recipientIds.forEach(rid => {
                        activeCallsMap.delete(`${userId}:${rid}`);
                        activeCallsMap.delete(`${rid}:${userId}`);
                    });
                }
            } catch (error) {
                console.error('Call end error:', error);
            }
        });

        // WebRTC signaling
        socket.on('webrtc:offer', (data: { recipientId: string; offer: object }) => {
            const recipientSockets = onlineUsers.get(data.recipientId);
            if (recipientSockets) {
                recipientSockets.forEach(socketId => {
                    io.to(socketId).emit('webrtc:offer', { userId, offer: data.offer });
                });
            }
        });

        socket.on('webrtc:answer', (data: { recipientId: string; answer: object }) => {
            const recipientSockets = onlineUsers.get(data.recipientId);
            if (recipientSockets) {
                recipientSockets.forEach(socketId => {
                    io.to(socketId).emit('webrtc:answer', { userId, answer: data.answer });
                });
            }
        });

        socket.on('webrtc:ice-candidate', (data: { recipientId: string; candidate: object }) => {
            const recipientSockets = onlineUsers.get(data.recipientId);
            if (recipientSockets) {
                recipientSockets.forEach(socketId => {
                    io.to(socketId).emit('webrtc:ice-candidate', { userId, candidate: data.candidate });
                });
            }
        });

        // ============ DISCONNECT ============

        socket.on('disconnect', async () => {
            console.log(`🔌 User disconnected: ${userId} (${socket.id})`);

            // Remove socket from online users
            const userSockets = onlineUsers.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    onlineUsers.delete(userId);

                    const now = new Date();

                    // Update user status
                    await User.findByIdAndUpdate(userId, {
                        status: 'offline',
                        lastSeen: now,
                    });

                    // Broadcast offline status (respecting privacy settings)
                    try {
                        const currentUser = await User.findById(userId).select('settings contacts');
                        const visibility = currentUser?.settings?.lastSeenVisibility || 'everyone';

                        if (visibility === 'everyone') {
                            socket.broadcast.emit('user:offline', { userId, lastSeen: now });
                        } else if (visibility === 'contacts') {
                            const contactIds = (currentUser?.contacts || []).map(c => c.toString());
                            for (const [uid, socketIds] of onlineUsers.entries()) {
                                if (contactIds.includes(uid)) {
                                    for (const sid of socketIds) {
                                        io.to(sid).emit('user:offline', { userId, lastSeen: now });
                                    }
                                }
                            }
                        }
                        // visibility === 'nobody' → don't broadcast at all
                    } catch (error) {
                        console.error('Privacy-filtered offline broadcast error:', error);
                    }
                }
            }
        });
    });
};

export const getOnlineUsers = (): string[] => {
    return Array.from(onlineUsers.keys());
};

export const isUserOnline = (userId: string): boolean => {
    return onlineUsers.has(userId);
};
