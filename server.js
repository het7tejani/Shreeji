require('dotenv').config();
const express = require('express');
const connectDB = require('./db');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('./models/User'); // Ensure User model is registered
const User = mongoose.model('user');

const app = express();

// Init Middleware
app.use(cors());
app.use(express.json({ extended: false }));

app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.use('/api/spices', require('./routes/spices'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/auth', require('./routes/auth'));


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
      // console.log('Admin user already exists.');
      return;
    }

    // Hashing logic (same as auth.js)
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
    await seedAdminUser(); // Run seed check on startup
    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();