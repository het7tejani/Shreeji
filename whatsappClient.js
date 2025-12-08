
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client;
let qrCodeDataUrl = null;
let status = 'INITIALIZING'; // INITIALIZING, QR_READY, CONNECTING, READY, ERROR

// Define function to initialize client
const initializeClient = () => {
    console.log("Initializing WhatsApp Client...");
    
    // Create new client instance
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Critical for Docker/Render
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('QR Code received');
        try {
            qrCodeDataUrl = await qrcode.toDataURL(qr);
            status = 'QR_READY';
        } catch (err) {
            console.error('Error generating QR image', err);
        }
    });

    client.on('authenticated', () => {
        console.log('Client is authenticated!');
        status = 'CONNECTING';
        qrCodeDataUrl = null; // Clear QR code immediately
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        status = 'READY';
        qrCodeDataUrl = null;
    });

    client.on('auth_failure', msg => {
        console.error('AUTHENTICATION FAILURE', msg);
        status = 'ERROR';
    });
    
    client.on('disconnected', async (reason) => {
        console.log('Client was disconnected', reason);
        status = 'INITIALIZING';
        qrCodeDataUrl = null;
        
        // Destroy the current client to free resources
        try {
            await client.destroy();
        } catch (e) {
            console.error('Error destroying client:', e);
        }
        
        // Re-initialize to start a new session (generate new QR)
        initializeClient();
    });

    try {
        client.initialize();
    } catch (error) {
        console.error("Failed to initialize WhatsApp client:", error);
        status = 'ERROR';
    }
};

// Start immediately
initializeClient();

const getStatus = () => {
    return {
        status,
        qrCode: qrCodeDataUrl
    };
};

const sendMessage = async (number, text, mediaObj) => {
    // Allow sending if READY or CONNECTING (Authenticated but syncing)
    if (status !== 'READY' && status !== 'CONNECTING') throw new Error('Client not ready');

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    let finalNumber = sanitizedNumber;
    if (finalNumber.length === 10) {
        finalNumber = '91' + finalNumber;
    }
    
    const chatId = `${finalNumber}@c.us`;

    try {
        if (mediaObj) {
            const media = new MessageMedia(mediaObj.mimetype, mediaObj.data, mediaObj.filename);
            await client.sendMessage(chatId, media, { caption: text });
        } else {
            await client.sendMessage(chatId, text);
        }
        return { success: true, number };
    } catch (err) {
        console.error(`Failed to send to ${number}:`, err);
        return { success: false, number, error: err.message };
    }
};

const logout = async () => {
    try {
        if (status === 'READY' || status === 'CONNECTING') {
            await client.logout(); // This triggers 'disconnected' event which handles re-init
        } else {
            // If not fully ready but we want to reset
            try { await client.destroy(); } catch (e) {}
            status = 'INITIALIZING';
            initializeClient();
        }
        return { success: true };
    } catch (error) {
        console.error('Error logging out:', error);
        // Force reset
        try { await client.destroy(); } catch (e) {}
        status = 'INITIALIZING';
        initializeClient();
        return { success: false, error: error.message };
    }
};

module.exports = {
    getStatus,
    sendMessage,
    logout
};
