import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBlock extends Document {
    blockerId: mongoose.Types.ObjectId;
    blockedId: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const blockSchema = new Schema(
    {
        _id: {
            type: String,
            required: true,
        },
        blockerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        blockedId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        _id: false, // We manage _id ourselves
        timestamps: true,
    }
);

// Compound indexes for fast lookups in both directions
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1, blockerId: 1 });
// Single-field indexes for "get all blocks by user" queries
blockSchema.index({ blockerId: 1, createdAt: -1 });
blockSchema.index({ blockedId: 1 });

/**
 * Generate the composite document ID for a block relationship.
 */
export function makeBlockId(blockerId: string, blockedId: string): string {
    return `${blockerId}_${blockedId}`;
}

export const Block: Model<IBlock> = mongoose.model<IBlock>('Block', blockSchema);
