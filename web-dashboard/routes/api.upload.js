const express = require('express');
const fs = require('fs');
const path = require('path');
const { auditSecurityEvent } = require('../server/security');

module.exports = function(server) {
    const router = express.Router();

    // Upload API (Direct Web Upload)
    router.post('/api/upload', async (req, res) => {
        try {
            const { fileName, base64Data } = req.body;
            if (!fileName || !base64Data) {
                return res.status(400).json({ error: 'Missing fileName or base64Data' });
            }

            const maxBytes = server.maxUploadBytes || 8 * 1024 * 1024;
            const cleanedBase64 = String(base64Data).includes(',')
                ? String(base64Data).split(',').pop()
                : String(base64Data);

            // Base64 encoded bytes are about 4/3 of binary size.
            const estimatedBytes = Math.floor((cleanedBase64.length * 3) / 4);
            if (estimatedBytes > maxBytes) {
                auditSecurityEvent(server, 'upload_rejected', req, {
                    reason: 'payload_too_large',
                    estimatedBytes,
                    maxBytes,
                });
                return res.status(413).json({ error: `Upload exceeds limit (${maxBytes} bytes)` });
            }

            // Create temp upload dir
            const uploadDir = path.join(process.cwd(), 'data', 'temp_uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            // Sanitize filename
            const normalizedName = String(fileName).replace(/[^a-z0-9._-]/gi, '_');
            const safeName = `${Date.now()}_${normalizedName}`;
            const filePath = path.join(uploadDir, safeName);

            // Save file
            const buffer = Buffer.from(cleanedBase64, 'base64');
            if (buffer.length > maxBytes) {
                auditSecurityEvent(server, 'upload_rejected', req, {
                    reason: 'decoded_too_large',
                    decodedBytes: buffer.length,
                    maxBytes,
                });
                return res.status(413).json({ error: `Upload exceeds limit (${maxBytes} bytes)` });
            }
            await fs.promises.writeFile(filePath, buffer);

            console.log(`💾 [WebServer] File uploaded: ${safeName}`);
            return res.json({ success: true, path: filePath, url: `/api/files/${safeName}` });
        } catch (e) {
            console.error('Failed to upload file:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
