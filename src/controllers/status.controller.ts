import { Response } from 'express';
import { Status, User } from '../models';
import { AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';
import { sendNotificationToMany, buildStatusNotification } from '../services/notification.service';

export const statusController = {
    // Create a new status
    async createStatus(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { type, content, media, textStyle, caption } = req.body;

            if (!type || !content) {
                res.status(400).json({ error: 'Type and content are required' });
                return;
            }

            const status = new Status({
                user: userId,
                type,
                content,
                media,
                textStyle,
                caption,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });

            await status.save();
            await status.populate('user', 'name avatar');

            // FCM: Notify all contacts about new status
            const creator = await User.findById(userId).select('name contacts').lean();
            if (creator && creator.contacts && creator.contacts.length > 0) {
                const contactIds = creator.contacts.map((c: any) => c.toString());
                const notif = buildStatusNotification(
                    creator.name || 'Someone',
                    type === 'text' ? 'text' : 'media',
                    userId!
                );
                sendNotificationToMany(contactIds, notif, userId).catch(() => {});
            }

            res.json({ status, message: 'Status created' });
        } catch (error) {
            console.error('Create status error:', error);
            res.status(500).json({ error: 'Failed to create status' });
        }
    },

    // Get statuses from contacts
    async getStatuses(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;

            // Get user's contacts
            const user = await User.findById(userId).select('contacts blockedUsers');
            const contactIds = user?.contacts || [];
            const blockedIds = user?.blockedUsers || [];

            // Get statuses from contacts (exclude blocked)
            const now = new Date();
            const statuses = await Status.find({
                user: { $in: contactIds, $nin: blockedIds },
                expiresAt: { $gt: now },
            })
                .populate('user', 'name avatar email phone')
                .sort({ createdAt: -1 });

            // Get own statuses
            const myStatuses = await Status.find({
                user: userId,
                expiresAt: { $gt: now },
            })
                .populate('user', 'name avatar email phone')
                .sort({ createdAt: -1 });

            // Group by user
            const groupedStatuses = new Map<string, typeof statuses>();
            statuses.forEach(status => {
                const odId = status.user._id.toString();
                if (!groupedStatuses.has(odId)) {
                    groupedStatuses.set(odId, []);
                }
                groupedStatuses.get(odId)!.push(status);
            });

            res.json({
                myStatuses,
                contactStatuses: Array.from(groupedStatuses.entries()).map(([_, userStatuses]) => ({
                    user: userStatuses[0].user,
                    statuses: userStatuses,
                    hasUnviewed: userStatuses.some(s =>
                        !s.viewers.some(v => v.user.toString() === userId)
                    ),
                })),
            });
        } catch (error) {
            console.error('Get statuses error:', error);
            res.status(500).json({ error: 'Failed to get statuses' });
        }
    },

    // View a status
    async viewStatus(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { statusId } = req.params;

            const status = await Status.findById(statusId);

            if (!status) {
                res.status(404).json({ error: 'Status not found' });
                return;
            }

            // Add viewer if not already viewed
            const alreadyViewed = status.viewers.some(
                v => v.user.toString() === userId
            );

            if (!alreadyViewed) {
                status.viewers.push({
                    user: new mongoose.Types.ObjectId(userId),
                    viewedAt: new Date(),
                });
                await status.save();
            }

            res.json({ success: true });
        } catch (error) {
            console.error('View status error:', error);
            res.status(500).json({ error: 'Failed to record view' });
        }
    },

    // Get status viewers
    async getStatusViewers(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { statusId } = req.params;

            const status = await Status.findOne({
                _id: statusId,
                user: userId,
            }).populate('viewers.user', 'name avatar');

            if (!status) {
                res.status(404).json({ error: 'Status not found' });
                return;
            }

            res.json({ viewers: status.viewers });
        } catch (error) {
            console.error('Get viewers error:', error);
            res.status(500).json({ error: 'Failed to get viewers' });
        }
    },

    // Delete a status
    async deleteStatus(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { statusId } = req.params;

            const result = await Status.findOneAndDelete({
                _id: statusId,
                user: userId,
            });

            if (!result) {
                res.status(404).json({ error: 'Status not found' });
                return;
            }

            res.json({ message: 'Status deleted' });
        } catch (error) {
            console.error('Delete status error:', error);
            res.status(500).json({ error: 'Failed to delete status' });
        }
    },
};
