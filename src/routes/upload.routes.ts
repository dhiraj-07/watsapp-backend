import { Router, Request, Response } from 'express';
import { upload } from '../utils/upload';
import { config } from '../config';

const router = Router();

router.post('/', upload.single('file'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        // Construct file URL
        // If config.frontendUrl is localhost, we assume backend is also localhost for now or use relative path
        // ideally we should have a BACKEND_URL in config, but I'll use a relative path logic or constructed URL
        // For development, we'll return the full URL based on the request host

        const protocol = req.protocol;
        const host = req.get('host');
        const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

        res.json({
            success: true,
            file: {
                url: fileUrl,
                filename: req.file.filename,
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
