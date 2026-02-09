import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '5000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // MongoDB
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-clone',

    // JWT
    jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

    // Firebase
    firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    },

    // Cloudinary
    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    // SMTP (for email OTP)
    smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'Streamify <noreply@streamify.app>',
    },

    // Redis
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

    // Frontend
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
