const express = require('express');
const { buildOperationGuard } = require('../server/security');

module.exports = function(server) {
    const router = express.Router();
    const requireConfigAdmin = buildOperationGuard(server, 'config_update');

    router.get('/api/config', (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envData = EnvManager.readEnv();
            return res.json({ env: envData, golems: [] });
        } catch (e) {
            console.error("Failed to read config:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/config', requireConfigAdmin, (req, res) => {
        try {
            const { env: envPayload } = req.body;

            if (!envPayload || typeof envPayload !== 'object') {
                return res.status(400).json({ error: "Invalid env payload" });
            }

            const EnvManager = require('../../src/utils/EnvManager');
            const envUpdated = EnvManager.updateEnv(envPayload);

            if (envUpdated) {
                console.log(`📝 [System] Saved new config. env updated: ${envUpdated}`);
                return res.json({ success: true, message: "Settings saved successfully. A system restart is required for changes to take effect." });
            }

            return res.json({ success: false, message: "No changes detected" });
        } catch (e) {
            console.error("Failed to update config:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
