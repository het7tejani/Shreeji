
require('dotenv').config();
const express = require('express');
const connectDB = require('./db');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
require('./models/User');
const User = mongoose.model('user');

// Import but don't initialize yet
const whatsappClient = require('./whatsappClient');

const app = express();

// Init Middleware
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options(/.*/, cors());

app.use(express.json({ limit: '50mb', extended: true }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- STATIC FILE SERVING ---
const buildPath = path.join(__dirname, '../dashboad/build');
app.use(express.static(buildPath));

app.get('/', (req, res) => {
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

// --- ERROR HANDLERS ---
app.use('/api/*', (req, res) => {
  res.status(404).json({ msg: `API Route Not Found: ${req.originalUrl}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'), (err) => {
    if (err) {
      console.error("Error sending index.html:", err);
      res.status(500).send("Server Error: Could not find frontend build files.");
    }
  });
});

app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  if (res.headersSent) {
      return next(err);
  }
  res.status(500).json({ msg: "Internal Server Error" });
});

const PORT = process.env.PORT || 5001;

// Seed Admin User
const seedAdminUser = async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) return;

  try {
    const userExists = await User.findOne({ username });
    if (userExists) return;

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
    console.log(`Admin user '${username}' created.`);

  } catch (err) {
    console.error('Error seeding admin user:', err.message);
  }
};

const startServer = async () => {
  try {
    await connectDB();
    await seedAdminUser();
    
    // Start WhatsApp Client AFTER Database is connected
    whatsappClient.initClient(mongoose);

    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
