import { Block, makeBlockId } from '../models';

/**
 * Check if either user has blocked the other (bidirectional check).
 * Returns true if ANY block exists between the two users.
 */
export async function isBlocked(userA: string, userB: string): Promise<boolean> {
    const count = await Block.countDocuments({
        $or: [
            { _id: makeBlockId(userA, userB) },
            { _id: makeBlockId(userB, userA) },
        ],
    });
    return count > 0;
}

/**
 * Check if `blockerId` has specifically blocked `blockedId`.
 * One-directional — does NOT check the reverse.
 */
export async function hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const doc = await Block.findById(makeBlockId(blockerId, blockedId)).lean();
    return !!doc;
}

/**
 * Get the set of user IDs that `userId` has blocked.
 */
export async function getBlockedByUser(userId: string): Promise<string[]> {
    const docs = await Block.find({ blockerId: userId }).select('blockedId').lean();
    return docs.map(d => d.blockedId.toString());
}

/**
 * Get the set of user IDs that have blocked `userId`.
 */
export async function getBlockersOfUser(userId: string): Promise<string[]> {
    const docs = await Block.find({ blockedId: userId }).select('blockerId').lean();
    return docs.map(d => d.blockerId.toString());
}

/**
 * Filter a list of user IDs, removing any that have a block relationship with `userId`.
 * Useful for filtering chat participants before emitting messages/notifications.
 */
export async function filterBlockedParticipants(
    userId: string,
    participantIds: string[]
): Promise<string[]> {
    if (participantIds.length === 0) return [];

    // Build all possible block pairs
    const blockIds = participantIds.flatMap(pid => [
        makeBlockId(userId, pid),
        makeBlockId(pid, userId),
    ]);

    const blocks = await Block.find({ _id: { $in: blockIds } }).select('blockerId blockedId').lean();

    const blockedSet = new Set<string>();
    for (const b of blocks) {
        blockedSet.add(b.blockerId.toString());
        blockedSet.add(b.blockedId.toString());
    }
    // Don't filter out userId itself
    blockedSet.delete(userId);

    return participantIds.filter(pid => !blockedSet.has(pid));
}
