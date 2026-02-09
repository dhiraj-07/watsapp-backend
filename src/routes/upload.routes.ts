import { Router, Request, Response } from 'express';
import { upload, uploadToCloudinary } from '../utils/upload';

const router = Router();

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
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

export default router;
