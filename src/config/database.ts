import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from './index';

let mongoServer: MongoMemoryServer | null = null;

async function fixStaleIndexes() {
    try {
        const db = mongoose.connection.db;
        if (!db) return;
        const collection = db.collection('users');
        const indexes = await collection.indexes();
        const phoneIndex = indexes.find((idx: any) => idx.name === 'phone_1');
        if (phoneIndex && phoneIndex.unique) {
            console.log('⚠️ Dropping stale unique phone_1 index...');
            await collection.dropIndex('phone_1');
            console.log('✅ Stale phone_1 index dropped');
        }
    } catch (err: any) {
        // Index might not exist, that's fine
        if (err.codeName !== 'IndexNotFound') {
            console.warn('Warning fixing indexes:', err.message);
        }
    }
}

export const connectDatabase = async (): Promise<void> => {
    try {
        // First try to connect to the configured MongoDB
        await mongoose.connect(config.mongodbUri, {
            serverSelectionTimeoutMS: 5000, // 5 second timeout
        });
        console.log('✅ MongoDB connected successfully');

        // Drop stale unique index on phone if it exists (non-sparse)
        await fixStaleIndexes();
    } catch (error) {
        console.log('⚠️ Local MongoDB not available, starting in-memory server...');

        // Fall back to in-memory MongoDB
        try {
            mongoServer = await MongoMemoryServer.create();
            const mongoUri = mongoServer.getUri();

            await mongoose.connect(mongoUri);
            console.log('✅ MongoDB Memory Server connected successfully');
            console.log('📝 Note: Data will be lost when server restarts');

            await fixStaleIndexes();
        } catch (memoryError) {
            console.error('❌ Failed to start in-memory MongoDB:', memoryError);
            process.exit(1);
        }
    }

    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected');
    });
};

export const disconnectDatabase = async (): Promise<void> => {
    await mongoose.disconnect();
    if (mongoServer) {
        await mongoServer.stop();
    }
};
