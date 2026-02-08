import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICall extends Document {
    _id: mongoose.Types.ObjectId;
    type: 'audio' | 'video';
    initiator: mongoose.Types.ObjectId;
    participants: Array<{
        user: mongoose.Types.ObjectId;
        status: 'pending' | 'accepted' | 'rejected' | 'missed';
        joinedAt?: Date;
        leftAt?: Date;
    }>;
    status: 'ringing' | 'ongoing' | 'ended' | 'missed';
    startedAt?: Date;
    endedAt?: Date;
    duration?: number;
    chat?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const callSchema = new Schema<ICall>(
    {
        type: {
            type: String,
            enum: ['audio', 'video'],
            required: true,
        },
        initiator: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        participants: [{
            user: {
                type: Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            status: {
                type: String,
                enum: ['pending', 'accepted', 'rejected', 'missed'],
                default: 'pending',
            },
            joinedAt: Date,
            leftAt: Date,
        }],
        status: {
            type: String,
            enum: ['ringing', 'ongoing', 'ended', 'missed'],
            default: 'ringing',
        },
        startedAt: Date,
        endedAt: Date,
        duration: Number,
        chat: {
            type: Schema.Types.ObjectId,
            ref: 'Chat',
        },
    },
    {
        timestamps: true,
    }
);

// Index for efficient queries
callSchema.index({ initiator: 1, createdAt: -1 });
callSchema.index({ 'participants.user': 1, createdAt: -1 });

export const Call: Model<ICall> = mongoose.model<ICall>('Call', callSchema);
