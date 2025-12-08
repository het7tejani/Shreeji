
const express = require('express');
const router = express.Router();
const whatsappClient = require('../whatsappClient');

// @route   GET api/whatsapp/status
// @desc    Get current connection status and QR code if waiting
router.get('/status', (req, res) => {
    try {
        const statusData = whatsappClient.getStatus();
        res.json(statusData);
    } catch (err) {
        res.status(500).json({ msg: 'Error getting status' });
    }
});

// @route   POST api/whatsapp/logout
// @desc    Disconnect WhatsApp session
router.post('/logout', async (req, res) => {
    try {
        await whatsappClient.logout();
        res.json({ msg: 'Logged out successfully. Reloading client...' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error logging out' });
    }
});

// @route   POST api/whatsapp/send
// @desc    Bulk send messages
router.post('/send', async (req, res) => {
    const { numbers, message, image } = req.body;

    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({ msg: 'No numbers provided' });
    }

    if (!message && !image) {
        return res.status(400).json({ msg: 'Message text or image is required' });
    }

    const statusData = whatsappClient.getStatus();
    if (statusData.status !== 'READY') {
        return res.status(503).json({ msg: 'WhatsApp client is not ready. Please scan QR code in settings.' });
    }

    // Respond immediately to the frontend, continue processing in background
    res.json({ msg: `Started sending to ${numbers.length} contacts.` });

    console.log(`[WhatsApp] Starting bulk send to ${numbers.length} numbers.`);
    
    // Process in background loop
    (async () => {
        for (const number of numbers) {
            try {
                await whatsappClient.sendMessage(number, message, image);
                
                // Wait random time between 4-6 seconds to avoid ban
                await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
            } catch (e) {
                console.error(`Failed loop for ${number}`, e);
                // If an error occurs, wait a bit longer (10s) before trying next
                await new Promise(r => setTimeout(r, 10000));
            }
        }
        console.log(`[WhatsApp] Bulk send complete.`);
    })();
});

module.exports = router;
