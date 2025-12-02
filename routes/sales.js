
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Sale');
const Sale = mongoose.model('sale');

// @route   GET api/sales
// @desc    Get recent sales history (global)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const sales = await Sale.find().sort({ date: -1 }).limit(50).populate('customer', 'name mobileNumber');
    res.json(sales);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
