import multer from 'multer';
import cloudinary from '../config/cloudinary';

// Use memory storage so files are buffered for Cloudinary upload
const storage = multer.memoryStorage();

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

/**
 * Upload a multer file buffer to Cloudinary.
 * Returns the Cloudinary upload result.
 */
export function uploadToCloudinary(
    file: Express.Multer.File,
    folder: string = 'streamify'
): Promise<{ secure_url: string; public_id: string; resource_type: string; format: string; bytes: number }> {
    return new Promise((resolve, reject) => {
        const resourceType = file.mimetype.startsWith('video/')
            ? 'video' as const
            : file.mimetype.startsWith('audio/')
                ? 'video' as const   // Cloudinary uses 'video' for audio files
                : file.mimetype.startsWith('image/')
                    ? 'image' as const
                    : 'raw' as const;     // PDFs, text, etc.

        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: resourceType,
            },
            (error, result) => {
                if (error || !result) {
                    reject(error || new Error('Cloudinary upload failed'));
                } else {
                    resolve(result as any);
                }
            }
        );
        stream.end(file.buffer);
    });
}
