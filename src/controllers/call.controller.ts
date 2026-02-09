import { Response } from 'express';
import { Call } from '../models/Call';
import { User } from '../models';
import { AuthRequest } from '../middleware/auth';

export const callController = {
    // Initiate a call
    async initiateCall(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { recipientIds, type, chatId } = req.body;

            if (!recipientIds || !recipientIds.length || !type) {
                res.status(400).json({ error: 'Recipients and type are required' });
                return;
            }

            const participants = recipientIds.map((id: string) => ({
                user: id,
                status: 'pending',
            }));

            const call = new Call({
                type,
                initiator: userId,
                participants,
                status: 'ringing',
                chat: chatId,
            });

            await call.save();
            await call.populate('initiator', 'name avatar');
            await call.populate('participants.user', 'name avatar');

            res.json({ call });
        } catch (error) {
            console.error('Initiate call error:', error);
            res.status(500).json({ error: 'Failed to initiate call' });
        }
    },

    // Accept a call
    async acceptCall(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { callId } = req.params;

            const call = await Call.findOneAndUpdate(
                {
                    _id: callId,
                    'participants.user': userId,
                    status: 'ringing',
                },
                {
                    $set: {
                        'participants.$.status': 'accepted',
                        'participants.$.joinedAt': new Date(),
                        status: 'ongoing',
                        startedAt: new Date(),
                    },
                },
                { new: true }
            ).populate('initiator participants.user', 'name avatar');

            if (!call) {
                res.status(404).json({ error: 'Call not found or already answered' });
                return;
            }

            res.json({ call });
        } catch (error) {
            console.error('Accept call error:', error);
            res.status(500).json({ error: 'Failed to accept call' });
        }
    },

    // Reject a call
    async rejectCall(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { callId } = req.params;

            const call = await Call.findOneAndUpdate(
                {
                    _id: callId,
                    'participants.user': userId,
                    status: 'ringing',
                },
                {
                    $set: {
                        'participants.$.status': 'rejected',
                        status: 'ended',
                        endedAt: new Date(),
                    },
                },
                { new: true }
            );

            if (!call) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            res.json({ message: 'Call rejected' });
        } catch (error) {
            console.error('Reject call error:', error);
            res.status(500).json({ error: 'Failed to reject call' });
        }
    },

    // End a call
    async endCall(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { callId } = req.params;

            const call = await Call.findOne({
                _id: callId,
                $or: [
                    { initiator: userId },
                    { 'participants.user': userId },
                ],
            });

            if (!call) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            call.status = 'ended';
            call.endedAt = new Date();

            if (call.startedAt) {
                call.duration = Math.floor(
                    (call.endedAt.getTime() - call.startedAt.getTime()) / 1000
                );
            }

            // Mark participant as left
            const participant = call.participants.find(
                p => p.user.toString() === userId
            );
            if (participant) {
                participant.leftAt = new Date();
            }

            await call.save();

            res.json({ call });
        } catch (error) {
            console.error('End call error:', error);
            res.status(500).json({ error: 'Failed to end call' });
        }
    },

    // Get call history
    async getCallHistory(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { limit = 50, before } = req.query;

            const query: Record<string, unknown> = {
                $or: [
                    { initiator: userId },
                    { 'participants.user': userId },
                ],
            };

            if (before) {
                query.createdAt = { $lt: new Date(before as string) };
            }

            const calls = await Call.find(query)
                .populate('initiator', 'name avatar email phone')
                .populate('participants.user', 'name avatar email phone')
                .populate('chat', 'type name avatar participants')
                .sort({ createdAt: -1 })
                .limit(parseInt(limit as string));

            res.json({ calls });
        } catch (error) {
            console.error('Get call history error:', error);
            res.status(500).json({ error: 'Failed to get call history' });
        }
    },
};
