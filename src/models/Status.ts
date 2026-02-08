import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IStatus extends Document {
    _id: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    type: 'image' | 'video' | 'text';
    content: string;
    media?: {
        url: string;
        thumbnail?: string;
        mimeType: string;
        duration?: number;
    };
    textStyle?: {
        backgroundColor: string;
        fontFamily: string;
        textColor: string;
    };
    caption?: string;
    viewers: Array<{
        user: mongoose.Types.ObjectId;
        viewedAt: Date;
    }>;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const statusSchema = new Schema<IStatus>(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['image', 'video', 'text'],
            required: true,
        },
        content: {
            type: String,
            required: true,
        },
        media: {
            url: String,
            thumbnail: String,
            mimeType: String,
            duration: Number,
        },
        textStyle: {
            backgroundColor: { type: String, default: '#25D366' },
            fontFamily: { type: String, default: 'sans-serif' },
            textColor: { type: String, default: '#FFFFFF' },
        },
        caption: String,
        viewers: [{
            user: { type: Schema.Types.ObjectId, ref: 'User' },
            viewedAt: { type: Date, default: Date.now },
        }],
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// TTL index for automatic expiry after 24 hours
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to set expiry
statusSchema.pre('save', function (next) {
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }
    next();
});

export const Status: Model<IStatus> = mongoose.model<IStatus>('Status', statusSchema);
