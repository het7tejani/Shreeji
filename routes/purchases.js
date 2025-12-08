
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

// @route   GET api/purchases/dues
// @desc    Get list of vendors with outstanding balance (Baki)
// @access  Public
router.get('/dues', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        // We calculate dynamic balance here to ensure accuracy even if DB field is stale
        const dues = await Purchase.aggregate([
            { 
                $match: { 
                    cancelled: { $ne: true }
                } 
            },
            {
                $project: {
                    vendorName: 1,
                    vendorMobile: 1,
                    date: 1,
                    grandTotal: 1,
                    paidAmount: 1,
                    // Dynamic balance calculation
                    dynamicBalance: { $subtract: ["$grandTotal", "$paidAmount"] }
                }
            },
            {
                $match: {
                    dynamicBalance: { $gt: 0.1 } // Filter where balance is effectively > 0
                }
            },
            {
                $group: {
                    _id: { 
                        name: "$vendorName", 
                        mobile: "$vendorMobile" 
                    },
                    totalBalance: { $sum: "$dynamicBalance" },
                    lastDate: { $max: "$date" },
                    records: { $push: { id: "$_id", date: "$date", total: "$grandTotal", paid: "$paidAmount", due: "$dynamicBalance" } }
                }
            },
            { $sort: { totalBalance: -1 } }
        ]);
        res.json(dues);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/purchases/settle
// @desc    Settle outstanding balance for a vendor (Pay dues)
// @access  Public
router.post('/settle', async (req, res) => {
    const { vendorName, vendorMobile, amount } = req.body;

    if (!vendorName || !amount || amount <= 0) {
        return res.status(400).json({ msg: 'Vendor name and valid amount are required.' });
    }

    try {
        // Find all purchases for this vendor (not cancelled)
        const query = {
            vendorName: vendorName,
            cancelled: { $ne: true }
        };
        
        if (vendorMobile) {
            query.vendorMobile = vendorMobile;
        }

        const purchases = await Purchase.find(query).sort({ date: 1 });

        if (purchases.length === 0) {
            return res.status(404).json({ msg: 'No records found for this vendor.' });
        }

        let remainingAmount = parseFloat(amount);
        let settledCount = 0;

        // FIFO: Pay off oldest bills first
        for (const purchase of purchases) {
            if (remainingAmount <= 0.01) break;

            // Calculate current real balance
            const currentBalance = purchase.grandTotal - purchase.paidAmount;

            if (currentBalance > 0) {
                // Calculate how much we can pay for this specific purchase
                const payAmount = Math.min(currentBalance, remainingAmount);

                purchase.paidAmount += payAmount;
                // Update the static balance field as well for consistency, though we use dynamic calc mostly
                purchase.balance = purchase.grandTotal - purchase.paidAmount;
                
                await purchase.save();

                remainingAmount -= payAmount;
                settledCount++;
            }
        }

        res.json({ 
            msg: `Payment of ₹${amount} recorded. Settled against ${settledCount} purchase records.`,
            remainingExcess: remainingAmount > 0 ? remainingAmount : 0
        });

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
  const { vendorName, vendorMobile, vendorAddress, items, grandTotal, paidAmount } = req.body;

  if (!vendorName) {
    return res.status(400).json({ msg: 'Vendor name is required' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ msg: 'Purchase items are required' });
  }

  try {
    const paid = Number(paidAmount) || 0;
    // If paidAmount is not provided (legacy calls), default logic assumes full payment? 
    // BUT for new logic, we calculate balance.
    // If user inputs nothing, balance = grandTotal.
    
    const balance = Math.max(0, grandTotal - paid);

    const newPurchase = new Purchase({
      vendorName,
      vendorMobile,
      vendorAddress,
      items,
      grandTotal,
      paidAmount: paid,
      balance: balance
    });
    await newPurchase.save();

    for (const item of items) {
       await Spice.updateOne(
        { id: item.spiceId },
        { $inc: { stock: item.quantityKg } }
      );
    }
    
    res.json({ msg: 'Purchase recorded and stock updated successfully', purchase: newPurchase });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;
