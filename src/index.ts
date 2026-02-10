import express, { Application, Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config';
import { connectDatabase } from './config/database';
import { initializeSocket } from './socket';

// Import routes
import authRoutes from './routes/auth.routes';
import chatRoutes from './routes/chat.routes';
import statusRoutes from './routes/status.routes';
import callRoutes from './routes/call.routes';
import uploadRoutes from './routes/upload.routes';
import path from 'path';

// Initialize Express app
const app: Application = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: config.frontendUrl,
        methods: ['GET', 'POST'],
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// Middleware
app.use(cors({
    origin: config.frontendUrl,
    credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/upload', uploadRoutes);

// API info
app.get('/api', (_req: Request, res: Response) => {
    res.json({
        message: 'WhatsApp Clone API v1.0',
        endpoints: {
            auth: '/api/auth',
            chats: '/api/chats',
        }
    });
});

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

import { Chat } from './models';

// Initialize Socket.io handlers
initializeSocket(io);

// =============================================
// Mute expiry background job
// Runs every 5 minutes to auto-unmute expired mutes
// =============================================
function startMuteExpiryJob() {
    const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    setInterval(async () => {
        try {
            const now = new Date();
            const result = await Chat.updateMany(
                {
                    'participants': {
                        $elemMatch: {
                            muted: true,
                            mutedUntil: { $ne: null, $lt: now },
                        },
                    },
                },
                {
                    $set: {
                        'participants.$[elem].muted': false,
                        'participants.$[elem].mutedUntil': null,
                    },
                },
                {
                    arrayFilters: [{ 'elem.muted': true, 'elem.mutedUntil': { $ne: null, $lt: now } }],
                }
            );
            if (result.modifiedCount > 0) {
                console.log(`🔔 Auto-unmuted expired mutes in ${result.modifiedCount} chat(s)`);
            }
        } catch (error) {
            console.error('Mute expiry job error:', error);
        }
    }, INTERVAL_MS);
    console.log('⏰ Mute expiry job started (runs every 5 min)');
}

// Start server
const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDatabase();

        // Start background jobs
        startMuteExpiryJob();

        server.listen(config.port, () => {
            console.log(`🚀 Server running on http://localhost:${config.port}`);
            console.log(`📊 Environment: ${config.nodeEnv}`);
            console.log(`🔌 Socket.io ready`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export { app, io };
