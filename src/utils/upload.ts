import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp-random-originalName
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

// File filter
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
        'audio/webm',       // Voice recordings (Chrome)
        'audio/ogg',        // Voice recordings (Firefox)
        'audio/mp4',        // Voice recordings (Safari)
        'audio/mpeg',       // MP3
        'audio/wav',        // WAV
        'application/pdf',  // Documents
        'text/plain'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Allowed: Images, Videos, PDFs, Text'));
    }
};

// Limits
const limits = {
    fileSize: 50 * 1024 * 1024, // 50MB limit
};

export const upload = multer({
    storage,
    fileFilter,
    limits
});
