const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
require('../models/User');
const User = mongoose.model('user');

// Hashing constants (matching existing settings logic for consistency)
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

const hashPassword = (password, salt) => {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
};

// @route   POST api/auth/register
// @desc    Register a new user
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ msg: 'Please enter a username and a password (min 4 chars).' });
  }

  try {
    let user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const hash = await hashPassword(password, salt);
    const passwordStored = `${salt}:${hash}`;

    user = new User({
      username,
      password: passwordStored
    });

    await user.save();
    res.json({ msg: 'User registered successfully', username: user.username });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/auth/login
// @desc    Authenticate user
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ msg: 'Please enter username and password' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid Credentials' });
    }

    const [salt, storedHash] = user.password.split(':');
    const hash = await hashPassword(password, salt);

    if (hash !== storedHash) {
      return res.status(400).json({ msg: 'Invalid Credentials' });
    }

    res.json({ msg: 'Login successful', username: user.username });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/auth/change-password
// @desc    Change password for logged in user
router.post('/change-password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ msg: 'New password must be at least 4 characters.' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const [salt, storedHash] = user.password.split(':');
    const hashAttempt = await hashPassword(currentPassword, salt);

    if (hashAttempt !== storedHash) {
      return res.status(400).json({ msg: 'Incorrect current password.' });
    }

    const newSalt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const newHash = await hashPassword(newPassword, newSalt);
    user.password = `${newSalt}:${newHash}`;

    await user.save();
    res.json({ msg: 'Password updated successfully.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/auth/verify
// @desc    Verify password (for protected actions)
router.post('/verify', async (req, res) => {
    const { username, password } = req.body;
  
    try {
      const user = await User.findOne({ username });
      if (!user) return res.status(400).json({ msg: 'Invalid user' });
  
      const [salt, storedHash] = user.password.split(':');
      const hash = await hashPassword(password, salt);
  
      if (hash !== storedHash) {
        return res.status(401).json({ msg: 'Invalid password' });
      }
  
      res.json({ success: true });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  });

module.exports = router;