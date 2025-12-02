const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Purchase');
const Purchase = mongoose.model('purchase');


// @route   GET api/purchases
// @desc    Get recent purchase history
// @access  Public
router.get('/', async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ date: -1 }).limit(10);
    res.json(purchases);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;