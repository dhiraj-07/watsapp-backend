import { Message } from '../models';
import { getSocketIO } from '../socket';
import { sendNotificationToMany, NotificationPayload } from './notification.service';

// Tracks which reminders have already been sent (messageId:reminderType)
const sentReminders = new Set<string>();

// Reminder thresholds in milliseconds
const REMINDER_THRESHOLDS = [
    { label: '1 day', ms: 24 * 60 * 60 * 1000, key: '1d' },
    { label: '1 hour', ms: 60 * 60 * 1000, key: '1h' },
    { label: '10 minutes', ms: 10 * 60 * 1000, key: '10m' },
];

async function checkEventReminders() {
    try {
        const now = new Date();
        // Look for events starting within the next 25 hours (covers all thresholds + buffer)
        const maxLookahead = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const eventMessages = await Message.find({
            messageType: 'event',
            isDeleted: false,
            'event.status': 'active',
            'event.reminderEnabled': true,
            'event.starts': { $gt: now, $lte: maxLookahead },
        }).populate('sender', 'name');

        const io = getSocketIO();
        if (!io) return;

        for (const msg of eventMessages) {
            if (!msg.event) continue;

            const startsAt = new Date(msg.event.starts).getTime();
            const timeUntil = startsAt - now.getTime();

            for (const threshold of REMINDER_THRESHOLDS) {
                const reminderKey = `${msg._id}:${threshold.key}`;

                // Skip if already sent
                if (sentReminders.has(reminderKey)) continue;

                // Check if we're within the threshold window (threshold ± 2.5 minutes)
                const windowMs = 2.5 * 60 * 1000;
                if (timeUntil <= threshold.ms + windowMs && timeUntil > threshold.ms - windowMs) {
                    // Get users who RSVP'd "going"
                    const goingUsers = msg.event.rsvps
                        .filter((r: any) => r.status === 'going')
                        .map((r: any) => r.user.toString());

                    if (goingUsers.length === 0) continue;

                    const eventName = msg.event.name || 'Event';
                    const senderName = (msg.sender as any)?.name || 'Someone';

                    // Emit socket event for real-time reminder
                    io.to(`chat:${msg.chat}`).emit('event:reminder', {
                        messageId: msg._id,
                        chatId: msg.chat,
                        eventName,
                        startsIn: threshold.label,
                    });

                    // Send push notifications to going users
                    const notification: NotificationPayload = {
                        type: 'new_message' as any,
                        title: `⏰ ${eventName}`,
                        body: `Starts in ${threshold.label}! Created by ${senderName}`,
                        data: {
                            type: 'event_reminder',
                            chatId: msg.chat.toString(),
                            messageId: msg._id!.toString(),
                            eventName,
                        },
                        priority: threshold.key === '10m' ? 'high' : 'normal',
                        channelId: 'event_reminders',
                        sound: 'default',
                    };

                    try {
                        await sendNotificationToMany(goingUsers, notification);
                    } catch (notifError) {
                        console.error('Event reminder notification error:', notifError);
                    }

                    sentReminders.add(reminderKey);
                    console.log(`📅 Sent "${threshold.label}" reminder for event "${eventName}" to ${goingUsers.length} user(s)`);
                }
            }
        }

        // Cleanup old entries from sentReminders (events that have already passed)
        if (sentReminders.size > 1000) {
            sentReminders.clear();
        }
    } catch (error) {
        console.error('Event reminder check error:', error);
    }
}

export function startEventReminderJob() {
    const INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes
    setInterval(checkEventReminders, INTERVAL_MS);
    console.log('📅 Event reminder job started (runs every 2 min)');
}
