import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChatParticipant {
    user: mongoose.Types.ObjectId;
    role: 'admin' | 'member';
    joinedAt: Date;
    muted: boolean;
    mutedUntil?: Date;
    isPinned: boolean;
    pinnedAt?: Date;
}

export interface IChat extends Document {
    _id: mongoose.Types.ObjectId;
    type: 'private' | 'group';
    name?: string;
    description?: string;
    avatar?: string;
    participants: IChatParticipant[];
    lastMessage?: mongoose.Types.ObjectId;
    lastMessageAt?: Date;
    createdBy: mongoose.Types.ObjectId;
    disappearingMessages: 'off' | '24h' | '7d' | '90d';
    isArchived: boolean;
    archivedBy: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const chatSchema = new Schema<IChat>(
    {
        type: {
            type: String,
            enum: ['private', 'group'],
            required: true,
        },
        name: {
            type: String,
            trim: true,
            maxlength: 100,
        },
        description: {
            type: String,
            maxlength: 500,
        },
        avatar: String,
        participants: [{
            user: {
                type: Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            role: {
                type: String,
                enum: ['admin', 'member'],
                default: 'member',
            },
            joinedAt: {
                type: Date,
                default: Date.now,
            },
            muted: {
                type: Boolean,
                default: false,
            },
            mutedUntil: Date,
            isPinned: {
                type: Boolean,
                default: false,
            },
            pinnedAt: Date,
        }],
        lastMessage: {
            type: Schema.Types.ObjectId,
            ref: 'Message',
        },
        lastMessageAt: Date,
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        disappearingMessages: {
            type: String,
            enum: ['off', '24h', '7d', '90d'],
            default: 'off',
        },
        isArchived: {
            type: Boolean,
            default: false,
        },
        archivedBy: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
    },
    {
        timestamps: true,
    }
);

// Index for efficient queries
chatSchema.index({ 'participants.user': 1, lastMessageAt: -1 });
chatSchema.index({ type: 1 });

export const Chat: Model<IChat> = mongoose.model<IChat>('Chat', chatSchema);
