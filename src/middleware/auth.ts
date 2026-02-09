import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User, IUser } from '../models';

export interface AuthRequest extends Request {
    user?: IUser;
    userId?: string;
}

interface JwtPayload {
    userId: string;
    email: string;
    iat: number;
    exp: number;
}

export const generateToken = (userId: string, email: string): string => {
    return jwt.sign(
        { userId, email },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
    );
};

export const generateRefreshToken = (userId: string): string => {
    return jwt.sign(
        { userId },
        config.jwtRefreshSecret,
        { expiresIn: '30d' }
    );
};

export const verifyToken = (token: string): JwtPayload | null => {
    try {
        return jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
        return null;
    }
};

export const authMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        const token = authHeader.split(' ')[1];
        const decoded = verifyToken(token);

        if (!decoded) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        const user = await User.findById(decoded.userId).select('-__v');

        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        req.user = user;
        req.userId = decoded.userId;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

export const optionalAuth = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = verifyToken(token);

            if (decoded) {
                const user = await User.findById(decoded.userId).select('-__v');
                if (user) {
                    req.user = user;
                    req.userId = decoded.userId;
                }
            }
        }

        next();
    } catch {
        next();
    }
};
