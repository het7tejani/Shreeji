
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode');
const mongoose = require('mongoose');

let client;
let qrCodeDataUrl = null;
let status = 'INITIALIZING'; // INITIALIZING, QR_READY, CONNECTING, READY, ERROR

// Initialize function that takes the mongoose connection
const initClient = (mongooseConnection) => {
    if (client) return; // Prevent multiple initializations

    console.log("Initializing WhatsApp Client with RemoteAuth...");
    
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // Backup session every 5 minutes
        }),
        // Increase timeouts for slow servers
        authTimeoutMs: 60000, 
        qrMaxRetries: 5,
        takeoverOnConflict: true,
        puppeteer: {
            headless: true,
            // Aggressive memory saving args
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-default-apps',
                '--mute-audio',
                '--no-default-browser-check',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-update',
                '--disable-features=AudioServiceOutOfProcess',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-notifications',
                '--disable-print-preview',
                '--disable-renderer-backgrounding',
                '--disable-speech-api',
                '--disable-sync'
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

    client.on('remote_session_saved', () => {
        console.log('WhatsApp Session saved to Database!');
    });

    client.on('authenticated', () => {
        console.log('Client is authenticated!');
        status = 'CONNECTING';
        qrCodeDataUrl = null;
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
        
        // On disconnect, destroy and try to re-init
        try {
            await client.destroy();
        } catch (e) {
            console.error('Error destroying client:', e);
        }
        client = null;
        initClient(mongoose); // Restart
    });

    try {
        client.initialize();
    } catch (error) {
        console.error("Failed to initialize WhatsApp client:", error);
        status = 'ERROR';
    }
};

const getStatus = () => {
    return {
        status,
        qrCode: qrCodeDataUrl
    };
};

const sendMessage = async (number, text, mediaObj) => {
    if (!client) throw new Error('Client not initialized');
    // Allow sending if READY or CONNECTING
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
        if (client) {
            await client.logout();
        }
        return { success: true };
    } catch (error) {
        console.error('Error logging out:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    initClient,
    getStatus,
    sendMessage,
    logout
};
