
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Purchase');
require('../models/Spice');

const Purchase = mongoose.model('purchase');
const Spice = mongoose.model('spice');


// @route   GET api/purchases
// @desc    Get recent purchase history
// @access  Public
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const purchases = await Purchase.find().sort({ date: -1 }).limit(50);
    res.json(purchases);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/purchases/vendors
// @desc    Get aggregated list of vendors (Kheduts)
// @access  Public
router.get('/vendors', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const vendors = await Purchase.aggregate([
            {
                $match: {
                    vendorName: { $ne: "Manual Stock Adjustment" },
                    cancelled: { $ne: true }
                }
            },
            {
                $group: {
                    _id: { 
                        name: { $toLower: "$vendorName" }, // Case insensitive grouping
                        mobile: "$vendorMobile" 
                    },
                    originalName: { $first: "$vendorName" },
                    address: { $first: "$vendorAddress" },
                    totalAmount: { $sum: "$grandTotal" },
                    lastPurchaseDate: { $max: "$date" },
                    purchaseCount: { $sum: 1 }
                }
            },
            { 
                $project: {
                    name: "$originalName",
                    mobile: "$_id.mobile",
                    address: 1,
                    totalAmount: 1,
                    lastPurchaseDate: 1,
                    purchaseCount: 1
                }
            },
            { $sort: { lastPurchaseDate: -1 } }
        ]);
        res.json(vendors);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/purchases/delete
// @desc    Force Delete a purchase and revert stock
// @access  Protected
router.delete('/delete', async (req, res) => {
    const { id } = req.query;
    console.log(`[DELETE PURCHASE] Request -> ID: ${id}`);

    try {
        let purchase = null;

        // 1. Direct Lookup
        if (id && mongoose.Types.ObjectId.isValid(id)) {
            purchase = await Purchase.findById(id);
        }
        if (!purchase && id) {
             // Try generic string ID
             purchase = await Purchase.findOne({ _id: id });
        }

        // 2. Memory Scan Fallback
        if (!purchase && id) {
            console.log("[DELETE PURCHASE] Starting Memory Scan...");
            const allPurchases = await Purchase.find().sort({ date: -1 }).limit(200);
            purchase = allPurchases.find(p => String(p._id) === String(id));
        }

        if (!purchase) {
            return res.status(404).json({ msg: 'Purchase record not found.' });
        }

        console.log(`[DELETE PURCHASE] Found. _id: ${purchase._id}`);

        // --- REVERT STOCK ---
        // Since we are deleting a purchase (which added stock), we must REMOVE that stock
        if (purchase.items && purchase.items.length > 0) {
            for (const item of purchase.items) {
                await Spice.updateOne(
                    { id: item.spiceId },
                    { $inc: { stock: -item.quantityKg } }
                );
            }
            console.log(`[DELETE PURCHASE] Stock reverted for ${purchase.items.length} items.`);
        }

        // Delete
        await Purchase.findByIdAndDelete(purchase._id);
        
        res.json({ msg: 'Purchase deleted and stock reverted successfully.' });

    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).json({ msg: err.message });
    }
});

// @route   POST api/spices/purchase
// @desc    Record a purchase and update stock
// @access  Public
router.post('/purchase', async (req, res) => {
  const { vendorName, vendorMobile, vendorAddress, items, grandTotal } = req.body;

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
      vendorAddress,
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

module.exports = router;
