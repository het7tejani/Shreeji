
require('dotenv').config();
const express = require('express');
const connectDB = require('./db');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path'); // Added for file path handling
require('./models/User'); // Ensure User model is registered
const User = mongoose.model('user');

// Initialize WhatsApp Client (It starts itself)
try {
    require('./whatsappClient');
} catch (e) {
    console.error("Failed to load WhatsApp Client:", e.message);
}

const app = express();

// Init Middleware
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Enable Pre-flight requests for all routes
app.options(/.*/, cors());

// Increase payload limit for images
app.use(express.json({ limit: '50mb', extended: true }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- STATIC FILE SERVING ---
// Define the path to the React Build directory
// server.js is in /live/backend/, so we go up one level (..) then into dashboad/build
const buildPath = path.join(__dirname, '../dashboad/build');

// Serve static files (css, js, images) from the build directory
app.use(express.static(buildPath));

app.get('/', (req, res) => {
    // If the React app is built, serve it. Otherwise show API status.
    res.sendFile(path.join(buildPath, 'index.html'), (err) => {
        if (err) res.send('API Running (Frontend not found at ' + buildPath + ')');
    });
});

// Define API Routes
app.use('/api/spices', require('./routes/spices'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

// --- GLOBAL ERROR HANDLERS ---

// 1. API 404 Handler
// This ensures that requests starting with /api/ that don't match a route return JSON 404
// instead of falling through to the React App (which would try to parse JSON and crash)
app.use('/api/*', (req, res) => {
  res.status(404).json({ msg: `API Route Not Found: ${req.originalUrl}` });
});

// 2. React SPA Catch-All Handler (The Fix for "Refresh 404")
// Any request that is NOT an API request and NOT a static file will be sent index.html.
// This allows React Router to handle the URL (e.g., /settings, /stock) on the client side.
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'), (err) => {
    if (err) {
      console.error("Error sending index.html:", err);
      res.status(500).send("Server Error: Could not find frontend build files.");
    }
  });
});

// 3. Global Error Middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  if (res.headersSent) {
      return next(err);
  }
  res.status(500).json({ msg: "Internal Server Error" });
});

const PORT = process.env.PORT || 5001;

// Seed Admin User Logic
const seedAdminUser = async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log('No ADMIN_USERNAME or ADMIN_PASSWORD in .env, skipping seed.');
    return;
  }

  try {
    const userExists = await User.findOne({ username });
    if (userExists) {
      return;
    }

    const SALT_LENGTH = 16;
    const KEY_LENGTH = 64;
    const ITERATIONS = 100000;
    const DIGEST = 'sha512';
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    
    const hashPassword = (pwd, s) => {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(pwd, s, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
                if (err) reject(err);
                resolve(derivedKey.toString('hex'));
            });
        });
    };

    const hash = await hashPassword(password, salt);
    const passwordStored = `${salt}:${hash}`;

    const newUser = new User({
      username,
      password: passwordStored
    });

    await newUser.save();
    console.log(`Admin user '${username}' created successfully from .env`);

  } catch (err) {
    console.error('Error seeding admin user:', err.message);
  }
};

const startServer = async () => {
  try {
    await connectDB();
    await seedAdminUser();
    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
