
const express = require('express');
const router = express.Router();
const whatsappClient = require('../whatsappClient');

// @route   GET api/whatsapp/status
// @desc    Get current connection status and QR code if waiting
router.get('/status', (req, res) => {
    try {
        const statusData = whatsappClient.getStatus();
        // Prevent caching of status
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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
        res.json({ msg: 'Logged out successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error logging out' });
    }
});

// @route   POST api/whatsapp/restart
// @desc    Force restart the WhatsApp client
router.post('/restart', async (req, res) => {
    try {
        await whatsappClient.restart();
        res.json({ msg: 'Bot restarting... Wait 30 seconds for QR code.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error restarting bot' });
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
    
    // Allow 'CONNECTING' state as well, since sync can happen in background
    if (statusData.status !== 'READY' && statusData.status !== 'CONNECTING') {
        return res.status(503).json({ msg: 'WhatsApp client is not ready. Please scan QR code in settings.' });
    }

    // --- NEW LOGIC: Test send first message ---
    const firstNumber = numbers[0];
    const remainingNumbers = numbers.slice(1);

    try {
        console.log(`[WhatsApp] Attempting verification send to ${firstNumber}...`);
        const result = await whatsappClient.sendMessage(firstNumber, message, image);

        if (!result.success) {
             throw new Error(result.error || "Failed to send verification message.");
        }

        // If we got here, the first message worked.
        // Send success response to frontend.
        res.json({ msg: `Message sent to ${firstNumber}. Remaining ${remainingNumbers.length} contacts will be processed in background.` });

        // Continue with remaining numbers in background
        if (remainingNumbers.length > 0) {
            (async () => {
                console.log(`[WhatsApp] Starting background send for remaining ${remainingNumbers.length} numbers.`);
                
                // Initial delay before starting the rest
                await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));

                for (const number of remainingNumbers) {
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
        }

    } catch (error) {
        console.error("[WhatsApp] Verification send failed:", error);
        return res.status(500).json({ 
            msg: 'Failed to send message. Bot may be disconnected or syncing. Please try resetting the bot.',
            error: error.message 
        });
    }
});

module.exports = router;
