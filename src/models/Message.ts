import mongoose, { Schema, Document, Model } from 'mongoose';

export type MessageType =
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'location'
    | 'sticker'
    | 'gif'
    | 'poll'
    | 'contact'
    | 'system'
    | 'call';

export interface IReaction {
    user: mongoose.Types.ObjectId;
    emoji: string;
    timestamp: Date;
}

export interface IMessage extends Document {
    _id: mongoose.Types.ObjectId;
    chat: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    content: string;
    messageType: MessageType;
    media?: {
        url: string;
        thumbnail?: string;
        mimeType: string;
        size: number;
        duration?: number;
        fileName?: string;
    };
    location?: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    poll?: {
        question: string;
        options: Array<{
            text: string;
            votes: mongoose.Types.ObjectId[];
        }>;
        allowMultiple: boolean;
    };
    replyTo?: mongoose.Types.ObjectId;
    forwardedFrom?: mongoose.Types.ObjectId;
    reactions: IReaction[];
    readBy: Array<{
        user: mongoose.Types.ObjectId;
        readAt: Date;
    }>;
    deliveredTo: Array<{
        user: mongoose.Types.ObjectId;
        deliveredAt: Date;
    }>;
    isDeleted: boolean;
    deletedFor: mongoose.Types.ObjectId[];
    isEdited: boolean;
    editedAt?: Date;
    isPinned: boolean;
    pinnedAt?: Date;
    pinnedBy?: mongoose.Types.ObjectId;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
    {
        chat: {
            type: Schema.Types.ObjectId,
            ref: 'Chat',
            required: true,
            index: true,
        },
        sender: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        content: {
            type: String,
            default: '',
        },
        messageType: {
            type: String,
            enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'sticker', 'gif', 'poll', 'contact', 'system', 'call'],
            default: 'text',
        },
        media: {
            url: String,
            thumbnail: String,
            mimeType: String,
            size: Number,
            duration: Number,
            fileName: String,
        },
        location: {
            latitude: Number,
            longitude: Number,
            address: String,
        },
        poll: {
            question: String,
            options: [{
                text: String,
                votes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
            }],
            allowMultiple: { type: Boolean, default: false },
        },
        replyTo: {
            type: Schema.Types.ObjectId,
            ref: 'Message',
        },
        forwardedFrom: {
            type: Schema.Types.ObjectId,
            ref: 'Message',
        },
        reactions: [{
            user: { type: Schema.Types.ObjectId, ref: 'User' },
            emoji: String,
            timestamp: { type: Date, default: Date.now },
        }],
        readBy: [{
            user: { type: Schema.Types.ObjectId, ref: 'User' },
            readAt: { type: Date, default: Date.now },
        }],
        deliveredTo: [{
            user: { type: Schema.Types.ObjectId, ref: 'User' },
            deliveredAt: { type: Date, default: Date.now },
        }],
        isDeleted: {
            type: Boolean,
            default: false,
        },
        deletedFor: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
        isEdited: {
            type: Boolean,
            default: false,
        },
        editedAt: Date,
        isPinned: {
            type: Boolean,
            default: false,
        },
        pinnedAt: Date,
        pinnedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        expiresAt: {
            type: Date,
            default: undefined,
        },
    },
    {
        timestamps: true,
    }
);

// TTL index: MongoDB will automatically delete documents when expiresAt is reached
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

// Compound index for efficient chat message queries
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });

export const Message: Model<IMessage> = mongoose.model<IMessage>('Message', messageSchema);
