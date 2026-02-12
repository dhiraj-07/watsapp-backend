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
        'text/plain',
        'text/csv',
        'application/msword',                                                          // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     // .docx
        'application/vnd.ms-excel',                                                    // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           // .xlsx
        'application/vnd.ms-powerpoint',                                               // .ppt
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // .pptx
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/json',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Allowed: Images, Videos, Audio, Documents (PDF, Office, Archives), Text, CSV, JSON'));
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

        // For raw files, include the original filename so Cloudinary preserves the extension in the URL
        const uploadOptions: Record<string, unknown> = {
            folder,
            resource_type: resourceType,
        };
        if (resourceType === 'raw' && file.originalname) {
            // Use original filename (without path) as public_id so the URL ends with the correct extension
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            uploadOptions.public_id = `${Date.now()}_${safeName}`;
            uploadOptions.use_filename = true;
            uploadOptions.unique_filename = false;
        }

        const stream = cloudinary.uploader.upload_stream(
            uploadOptions,
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
