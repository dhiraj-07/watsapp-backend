import { Response } from 'express';
import { Chat, Message } from '../models';
import { AuthRequest } from '../middleware/auth';

export const eventController = {
    // Get all events for a chat (upcoming + past)
    async getChatEvents(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { chatId } = req.params;

            // Verify user is participant
            const chat = await Chat.findOne({
                _id: chatId,
                'participants.user': userId,
            });

            if (!chat) {
                res.status(404).json({ error: 'Chat not found' });
                return;
            }

            const now = new Date();

            // Get all event messages for this chat
            const eventMessages = await Message.find({
                chat: chatId,
                messageType: 'event',
                isDeleted: false,
                deletedFor: { $ne: userId },
            })
                .populate('sender', 'name avatar')
                .populate('event.rsvps.user', 'name avatar')
                .sort({ 'event.starts': 1 });

            const upcoming = eventMessages.filter(
                m => m.event && new Date(m.event.starts) >= now && m.event.status !== 'cancelled'
            );

            const past = eventMessages.filter(
                m => m.event && (new Date(m.event.starts) < now || m.event.status === 'cancelled')
            );

            res.json({
                upcoming: upcoming.map(m => m.toObject()),
                past: past.map(m => m.toObject()),
            });
        } catch (error) {
            console.error('Get chat events error:', error);
            res.status(500).json({ error: 'Failed to get events' });
        }
    },

    // Get a single event
    async getEvent(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { messageId } = req.params;

            const message = await Message.findOne({
                _id: messageId,
                messageType: 'event',
                isDeleted: false,
            })
                .populate('sender', 'name avatar')
                .populate('event.rsvps.user', 'name avatar');

            if (!message || !message.event) {
                res.status(404).json({ error: 'Event not found' });
                return;
            }

            // Verify user is participant in the chat
            const chat = await Chat.findOne({
                _id: message.chat,
                'participants.user': userId,
            });

            if (!chat) {
                res.status(403).json({ error: 'Not authorized' });
                return;
            }

            res.json({ event: message.toObject() });
        } catch (error) {
            console.error('Get event error:', error);
            res.status(500).json({ error: 'Failed to get event' });
        }
    },
};
