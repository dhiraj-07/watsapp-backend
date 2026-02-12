import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { upload, uploadToCloudinary } from '../utils/upload';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        // Upload to Cloudinary
        const result = await uploadToCloudinary(req.file, 'streamify');

        res.json({
            success: true,
            file: {
                url: result.secure_url,
                publicId: result.public_id,
                filename: req.file.originalname,
                mimetype: req.file.mimetype,
                originalname: req.file.originalname,
                size: req.file.size
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Error-handling middleware for multer errors
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
        return;
    }
    if (err && err.message === 'Invalid file type. Allowed: Images, Videos, Audio, Documents (PDF, Office, Archives), Text, CSV, JSON') {
        res.status(400).json({ error: err.message });
        return;
    }
    res.status(500).json({ error: 'Upload failed' });
});

export default router;
