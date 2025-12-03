
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

require('../models/Spice');
require('../models/Purchase');
require('../models/Customer');
require('../models/Sale');
require('../models/PaymentLog'); 

const Spice = mongoose.model('spice');
const Purchase = mongoose.model('purchase');
const Customer = mongoose.model('customer');
const Sale = mongoose.model('sale');
const PaymentLog = mongoose.model('paymentLog');


// @route   GET api/spices
// @desc    Get all spices
// @access  Public
router.get('/', async (req, res) => {
  try {
    const spices = await Spice.find().sort({ id: 1 });
    res.json(spices);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST api/spices/add
// @desc    Add a new spice
// @access  Public
router.post('/add', async (req, res) => {
  const { name, category } = req.body;
  if (!name) {
    return res.status(400).json({ msg: 'Spice name is required' });
  }

  try {
    const lastSpice = await Spice.findOne().sort({ id: -1 });
    const newId = lastSpice && !isNaN(lastSpice.id) ? lastSpice.id + 1 : 1;

    const newSpice = new Spice({
      id: newId,
      name: name.trim(),
      stock: 0,
      category: category || 'Ground'
    });

    await newSpice.save();
    const spices = await Spice.find().sort({ id: 1 });
    res.json(spices);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   DELETE api/spices/:id
// @desc    Delete a spice by custom ID
// @access  Public
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Spice.findOneAndDelete({ id: parseInt(req.params.id, 10) });
    if (!deleted) {
      return res.status(404).json({ msg: 'Spice not found' });
    }
    const spices = await Spice.find().sort({ id: 1 });
    res.json(spices);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST api/spices/update
// @desc    Update stock for multiple spices
// @access  Public
router.post('/update', async (req, res) => {
  const { stockUpdates } = req.body;

  if (!stockUpdates) {
    return res.status(400).json({ msg: 'Stock updates are required' });
  }

  try {
    for (const id in stockUpdates) {
      if (Object.prototype.hasOwnProperty.call(stockUpdates, id)) {
        await Spice.updateOne(
          { id: parseInt(id, 10) },
          { $set: { stock: stockUpdates[id] } }
        );
      }
    }

    const updatedSpices = await Spice.find().sort({ id: 1 });
    res.json(updatedSpices);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST api/spices/purchase
// @desc    Record a purchase and update stock
// @access  Public
router.post('/purchase', async (req, res) => {
  const { vendorName, vendorMobile, items, grandTotal } = req.body;

  if (!vendorName) {
    return res.status(400).json({ msg: 'Vendor name is required' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ msg: 'Purchase items are required' });
  }

  try {
    const newPurchase = new Purchase({
      vendorName,
      vendorMobile,
      items,
      grandTotal,
    });
    await newPurchase.save();

    for (const item of items) {
       await Spice.updateOne(
        { id: item.spiceId },
        { $inc: { stock: item.quantityKg } }
      );
    }
    
    res.json({ msg: 'Purchase recorded and stock updated successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST api/spices/sell
// @desc    Record a sale, manage customer, and decrease stock
// @access  Public
router.post('/sell', async (req, res) => {
  const { customerInfo, items, finalTotal, borrowing, amountToPay, saleSource, labor, commission, discount } = req.body;

  if (!customerInfo || !customerInfo.mobileNumber || !customerInfo.name) {
    return res.status(400).json({ msg: 'Customer mobile number and name are required' });
  }

  try {
    // Verify stock
    for (const item of items) {
      const spice = await Spice.findOne({ id: item.spiceId }).lean();
      if (!spice || spice.stock < item.quantityKg) {
        return res.status(400).json({
          msg: `Not enough stock for ${item.name}. Available: ${spice ? spice.stock : 0}kg.`
        });
      }
    }

    // Manage Customer Logic (Explicit Check)
    let customer = await Customer.findOne({ mobileNumber: customerInfo.mobileNumber });

    if (customer) {
        // Update existing customer details
        if (customerInfo.address) {
            customer.address = customerInfo.address;
        }
        // Add tag if not present
        if (saleSource && !customer.tags.includes(saleSource)) {
            customer.tags.push(saleSource);
        }
        await customer.save();
    } else {
        // Create NEW customer if not found (e.g., deleted or new)
        customer = new Customer({
            name: customerInfo.name,
            mobileNumber: customerInfo.mobileNumber,
            address: customerInfo.address,
            tags: saleSource ? [saleSource] : []
        });
        await customer.save();
    }

    // Get next bill number
    const lastSale = await Sale.findOne({}, { billNumber: 1 }).sort({ billNumber: -1 }).limit(1);
    let nextBillNum = 1;
    if (lastSale && lastSale.billNumber) {
        nextBillNum = lastSale.billNumber + 1;
    }

    // Create a unique Custom ID for reliable future deletion
    const uniqueCustomId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const newSale = new Sale({
      customId: uniqueCustomId, 
      customer: customer._id,
      billNumber: nextBillNum,
      items,
      finalTotal,
      borrowing,
      amountToPay,
      labor: labor || 0,
      commission: commission || 0,
      discount: discount || 0,
      type: saleSource || 'Retail'
    });
    await newSale.save();

    if (amountToPay > 0) {
        const log = new PaymentLog({
            customer: customer._id,
            saleId: newSale._id,
            amount: amountToPay,
            note: 'Initial Payment (At Sale)',
            type: saleSource || 'Retail'
        });
        await log.save();
    }

    for (const item of items) {
      await Spice.updateOne(
        { id: item.spiceId },
        { $inc: { stock: -item.quantityKg } }
      );
    }

    res.json({ msg: 'Sale recorded successfully', sale: newSale });

  } catch (err) {
    console.error('Server Error:', err.message);
    res.status(500).json({ msg: err.message });
  }
});


module.exports = router;
