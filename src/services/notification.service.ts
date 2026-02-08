import admin from 'firebase-admin';
import { config } from '../config';
import { User, IUser } from '../models';

// =============================================
// Firebase Admin SDK initialization
// =============================================
let firebaseInitialized = false;

function initFirebase() {
    if (firebaseInitialized) return;

    const { projectId, clientEmail, privateKey } = config.firebase;

    if (projectId && clientEmail && privateKey) {
        try {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId,
                    clientEmail,
                    privateKey,
                }),
            });
            firebaseInitialized = true;
            console.log('🔔 Firebase Admin SDK initialized');
        } catch (error) {
            console.warn('⚠️ Firebase Admin SDK initialization failed:', error);
        }
    } else {
        console.warn('⚠️ Firebase credentials not configured — push notifications disabled');
    }
}

// Initialize on module load
initFirebase();

// =============================================
// Types
// =============================================
export type NotificationType =
    | 'new_message'
    | 'message_reaction'
    | 'message_reply'
    | 'incoming_call'
    | 'missed_call'
    | 'status_update'
    | 'group_created'
    | 'group_member_added'
    | 'group_member_removed'
    | 'group_admin_change'
    | 'poll_created'
    | 'poll_vote';

export interface NotificationPayload {
    type: NotificationType;
    title: string;
    body: string;
    imageUrl?: string;
    data: Record<string, string>;
    // High priority for calls, normal for others
    priority?: 'high' | 'normal';
    // Channel ID for Android notification channels
    channelId?: string;
    // Tag for collapsing similar notifications
    tag?: string;
    // Badge count
    badgeCount?: number;
    // Sound
    sound?: string;
    // Actions (quick reply, mark as read, etc.)
    actions?: Array<{ action: string; title: string; icon?: string }>;
}

// =============================================
// Token Management
// =============================================

/**
 * Register an FCM token for a user (supports multiple devices)
 */
export async function registerFCMToken(userId: string, token: string): Promise<void> {
    if (!token) return;

    // Remove this token from any other user (device switched accounts)
    await User.updateMany(
        { _id: { $ne: userId } },
        { $pull: { fcmTokens: token } }
    );

    // Add token to current user (avoid duplicates)
    await User.findByIdAndUpdate(userId, {
        $addToSet: { fcmTokens: token },
        // Also keep legacy field updated
        fcmToken: token,
    });
}

/**
 * Remove an FCM token (on logout or token refresh)
 */
export async function removeFCMToken(userId: string, token: string): Promise<void> {
    await User.findByIdAndUpdate(userId, {
        $pull: { fcmTokens: token },
    });
}

/**
 * Get all FCM tokens for a user
 */
async function getUserTokens(userId: string): Promise<string[]> {
    const user = await User.findById(userId).select('fcmTokens fcmToken').lean();
    if (!user) return [];

    const tokens = new Set<string>();
    if (user.fcmTokens && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t: string) => tokens.add(t));
    }
    // Fallback to legacy single token
    if (user.fcmToken) {
        tokens.add(user.fcmToken);
    }
    return Array.from(tokens).filter(Boolean);
}

/**
 * Check if user has notifications enabled and is not muted for a chat
 */
async function shouldNotify(userId: string, chatId?: string): Promise<boolean> {
    const user = await User.findById(userId)
        .select('settings')
        .lean() as IUser | null;

    if (!user) return false;
    if (!user.settings?.notifications) return false;

    // TODO: Check per-chat mute settings when implemented
    return true;
}

// =============================================
// Core Send Function
// =============================================

/**
 * Send push notification to a single user (all their devices)
 */
export async function sendNotification(
    userId: string,
    payload: NotificationPayload
): Promise<void> {
    if (!firebaseInitialized) {
        console.log(`📱 [FCM Disabled] → ${payload.type} to ${userId}: ${payload.title} — ${payload.body}`);
        return;
    }

    // Check user notification preferences
    const canNotify = await shouldNotify(userId, payload.data.chatId);
    if (!canNotify) return;

    const tokens = await getUserTokens(userId);
    if (tokens.length === 0) return;

    const message: admin.messaging.MulticastMessage = {
        tokens,
        // Data payload — always delivered (background + foreground)
        data: {
            ...payload.data,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
            ...(payload.tag && { tag: payload.tag }),
            ...(payload.channelId && { channelId: payload.channelId }),
            ...(payload.actions && { actions: JSON.stringify(payload.actions) }),
            timestamp: Date.now().toString(),
        },
        // Notification payload — shown by OS when app is background/killed
        notification: {
            title: payload.title,
            body: payload.body,
            ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        // Android config
        android: {
            priority: payload.priority === 'high' ? 'high' : 'normal',
            notification: {
                channelId: payload.channelId || 'messages',
                sound: payload.sound || 'default',
                ...(payload.tag && { tag: payload.tag }),
                clickAction: 'OPEN_APP',
                defaultVibrateTimings: true,
                defaultSound: true,
            },
            ttl: payload.type === 'incoming_call' ? 30000 : 86400000, // 30s for calls, 24h for others
        },
        // Web push config
        webpush: {
            headers: {
                Urgency: payload.priority === 'high' ? 'high' : 'normal',
                TTL: payload.type === 'incoming_call' ? '30' : '86400',
            },
            notification: {
                title: payload.title,
                body: payload.body,
                icon: '/icon-192.svg',
                badge: '/icon-192.svg',
                ...(payload.imageUrl && { image: payload.imageUrl }),
                ...(payload.tag && { tag: payload.tag }),
                renotify: true,
                requireInteraction: payload.type === 'incoming_call',
                vibrate: payload.type === 'incoming_call'
                    ? [200, 100, 200, 100, 200, 100, 200]
                    : [200, 100, 200],
                data: {
                    ...payload.data,
                    type: payload.type,
                },
                actions: payload.actions?.map(a => ({
                    action: a.action,
                    title: a.title,
                    ...(a.icon && { icon: a.icon }),
                })),
            },
            fcmOptions: {
                link: payload.data.url || '/',
            },
        },
        // APNs config (iOS)
        apns: {
            headers: {
                'apns-priority': payload.priority === 'high' ? '10' : '5',
                ...(payload.tag && { 'apns-collapse-id': payload.tag }),
            },
            payload: {
                aps: {
                    alert: {
                        title: payload.title,
                        body: payload.body,
                    },
                    sound: payload.sound || 'default',
                    badge: payload.badgeCount || 1,
                    'mutable-content': 1, // For rich notifications
                    'content-available': 1, // For background delivery
                    category: payload.type,
                },
            },
        },
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);

        // Clean up invalid tokens
        if (response.failureCount > 0) {
            const invalidTokens: string[] = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (
                        errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered'
                    ) {
                        invalidTokens.push(tokens[idx]);
                    }
                }
            });

            if (invalidTokens.length > 0) {
                await User.findByIdAndUpdate(userId, {
                    $pull: { fcmTokens: { $in: invalidTokens } },
                });
                console.log(`🗑️ Removed ${invalidTokens.length} invalid FCM tokens for user ${userId}`);
            }
        }
    } catch (error) {
        console.error(`❌ FCM send error for user ${userId}:`, error);
    }
}

/**
 * Send notification to multiple users
 */
export async function sendNotificationToMany(
    userIds: string[],
    payload: NotificationPayload,
    excludeUserId?: string
): Promise<void> {
    const targets = excludeUserId
        ? userIds.filter(id => id !== excludeUserId)
        : userIds;

    await Promise.allSettled(
        targets.map(uid => sendNotification(uid, payload))
    );
}

// =============================================
// Notification Builders — per event type
// =============================================

/**
 * New message notification
 */
export function buildMessageNotification(
    senderName: string,
    content: string,
    messageType: string,
    chatId: string,
    chatName?: string,
    isGroup?: boolean,
    imageUrl?: string
): NotificationPayload {
    let body = content;
    if (messageType === 'image') body = '📷 Photo';
    else if (messageType === 'video') body = '🎬 Video';
    else if (messageType === 'audio') body = '🎤 Voice message';
    else if (messageType === 'document') body = '📄 Document';
    else if (messageType === 'location') body = '📍 Location';
    else if (messageType === 'sticker') body = '🏷️ Sticker';
    else if (messageType === 'gif') body = 'GIF';
    else if (messageType === 'poll') body = '📊 Poll';
    else if (messageType === 'contact') body = '👤 Contact';

    const title = isGroup && chatName
        ? `${senderName} @ ${chatName}`
        : senderName;

    return {
        type: 'new_message',
        title,
        body: body.length > 100 ? body.slice(0, 100) + '…' : body,
        imageUrl: messageType === 'image' ? imageUrl : undefined,
        data: {
            chatId,
            senderId: '',
            messageType,
            url: `/?chat=${chatId}`,
        },
        channelId: 'messages',
        tag: `chat_${chatId}`,
        sound: 'default',
        actions: [
            { action: 'reply', title: 'Reply' },
            { action: 'mark_read', title: 'Mark as Read' },
        ],
    };
}

/**
 * Message reaction notification
 */
export function buildReactionNotification(
    reactorName: string,
    emoji: string,
    chatId: string,
    originalContent: string
): NotificationPayload {
    return {
        type: 'message_reaction',
        title: reactorName,
        body: `Reacted ${emoji} to: "${originalContent.slice(0, 50)}"`,
        data: { chatId, url: `/?chat=${chatId}` },
        channelId: 'reactions',
        tag: `reaction_${chatId}`,
    };
}

/**
 * Incoming call notification (high priority)
 */
export function buildIncomingCallNotification(
    callerName: string,
    callType: 'audio' | 'video',
    callerId: string
): NotificationPayload {
    return {
        type: 'incoming_call',
        title: callerName,
        body: `Incoming ${callType} call…`,
        data: {
            callerId,
            callType,
            url: '/',
        },
        priority: 'high',
        channelId: 'calls',
        sound: 'ringtone',
        actions: [
            { action: 'accept', title: 'Accept' },
            { action: 'decline', title: 'Decline' },
        ],
    };
}

/**
 * Missed call notification
 */
export function buildMissedCallNotification(
    callerName: string,
    callType: 'audio' | 'video',
    callerId: string
): NotificationPayload {
    return {
        type: 'missed_call',
        title: 'Missed call',
        body: `${callerName} · ${callType === 'video' ? 'Video' : 'Voice'} call`,
        data: {
            callerId,
            callType,
            url: '/',
        },
        channelId: 'calls',
        tag: `missed_call_${callerId}`,
        actions: [
            { action: 'call_back', title: 'Call Back' },
        ],
    };
}

/**
 * Status update notification
 */
export function buildStatusNotification(
    userName: string,
    statusType: string,
    userId: string
): NotificationPayload {
    const typeLabel = statusType === 'text' ? 'text' : statusType === 'image' ? 'photo' : 'video';
    return {
        type: 'status_update',
        title: 'Status update',
        body: `${userName} posted a new ${typeLabel} status`,
        data: { userId, statusType, url: '/' },
        channelId: 'status',
        tag: `status_${userId}`,
    };
}

/**
 * Group event notification
 */
export function buildGroupNotification(
    chatId: string,
    chatName: string,
    event: 'member_added' | 'member_removed' | 'admin_promoted' | 'admin_demoted' | 'created',
    actorName: string,
    targetName?: string
): NotificationPayload {
    let body: string;
    switch (event) {
        case 'created':
            body = `${actorName} created the group "${chatName}"`;
            break;
        case 'member_added':
            body = `${actorName} added ${targetName || 'someone'} to "${chatName}"`;
            break;
        case 'member_removed':
            body = `${actorName} removed ${targetName || 'someone'} from "${chatName}"`;
            break;
        case 'admin_promoted':
            body = `${targetName || 'Someone'} is now an admin in "${chatName}"`;
            break;
        case 'admin_demoted':
            body = `${targetName || 'Someone'} is no longer an admin in "${chatName}"`;
            break;
        default:
            body = `Update in "${chatName}"`;
    }

    const typeMap: Record<string, NotificationType> = {
        created: 'group_created',
        member_added: 'group_member_added',
        member_removed: 'group_member_removed',
        admin_promoted: 'group_admin_change',
        admin_demoted: 'group_admin_change',
    };

    return {
        type: typeMap[event] || 'group_created',
        title: chatName,
        body,
        data: { chatId, url: `/?chat=${chatId}` },
        channelId: 'groups',
        tag: `group_${chatId}`,
    };
}

/**
 * Poll created notification
 */
export function buildPollNotification(
    creatorName: string,
    question: string,
    chatId: string,
    chatName?: string
): NotificationPayload {
    return {
        type: 'poll_created',
        title: chatName || creatorName,
        body: `📊 ${creatorName}: ${question}`,
        data: { chatId, url: `/?chat=${chatId}` },
        channelId: 'messages',
        tag: `chat_${chatId}`,
    };
}
