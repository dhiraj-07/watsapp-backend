import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from './index';

let mongoServer: MongoMemoryServer | null = null;

export const connectDatabase = async (): Promise<void> => {
    try {
        // First try to connect to the configured MongoDB
        await mongoose.connect(config.mongodbUri, {
            serverSelectionTimeoutMS: 5000, // 5 second timeout
        });
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.log('⚠️ Local MongoDB not available, starting in-memory server...');

        // Fall back to in-memory MongoDB
        try {
            mongoServer = await MongoMemoryServer.create();
            const mongoUri = mongoServer.getUri();

            await mongoose.connect(mongoUri);
            console.log('✅ MongoDB Memory Server connected successfully');
            console.log('📝 Note: Data will be lost when server restarts');
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
