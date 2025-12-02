
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
require('../models/Setting');
require('../models/Customer');
require('../models/Sale');
require('../models/Purchase');
require('../models/Spice');
require('../models/PaymentLog');

const Setting = mongoose.model('setting');
const Customer = mongoose.model('customer');
const Sale = mongoose.model('sale');
const Purchase = mongoose.model('purchase');
const Spice = mongoose.model('spice');
const PaymentLog = mongoose.model('paymentLog');

// Hashing constants
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

// Helper to hash password
const hashPassword = (password, salt) => {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
};

// @route   GET api/settings/has-password
// @desc    Check if a password has been set
router.get('/has-password', async (req, res) => {
  try {
    const passwordSetting = await Setting.findOne({ key: 'password' });
    res.json({ hasPassword: !!passwordSetting });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/settings/set-password
// @desc    Create or change the admin password
router.post('/set-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ msg: 'New password must be at least 4 characters long.' });
  }

  try {
    const passwordSetting = await Setting.findOne({ key: 'password' });

    if (passwordSetting) {
      // Password exists, so we're changing it
      if (!currentPassword) {
        return res.status(400).json({ msg: 'Current password is required to change it.' });
      }
      const [salt, storedHash] = passwordSetting.value.split(':');
      const hashAttempt = await hashPassword(currentPassword, salt);

      if (hashAttempt !== storedHash) {
        return res.status(401).json({ msg: 'Incorrect current password.' });
      }
    }

    // Hash and save the new password
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const newHash = await hashPassword(newPassword, salt);
    const storedValue = `${salt}:${newHash}`;

    await Setting.findOneAndUpdate(
      { key: 'password' },
      { value: storedValue },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ msg: 'Password updated successfully.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/settings/verify-password
// @desc    Verify the admin password
router.post('/verify-password', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ msg: 'Password is required.' });
  }
  
  try {
    const passwordSetting = await Setting.findOne({ key: 'password' });
    if (!passwordSetting) {
        return res.status(404).json({ msg: 'No password has been set for this application.' });
    }

    const [salt, storedHash] = passwordSetting.value.split(':');
    const hashAttempt = await hashPassword(password, salt);

    if (hashAttempt !== storedHash) {
      return res.status(401).json({ msg: 'Incorrect password.' });
    }

    res.json({ success: true, msg: 'Password verified.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/settings/export
// @desc    Export all data
router.get('/export', async (req, res) => {
    try {
        const customers = await Customer.find();
        const sales = await Sale.find();
        const purchases = await Purchase.find();
        const spices = await Spice.find();

        const data = {
            timestamp: new Date(),
            customers,
            sales,
            purchases,
            spices
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=spice_manager_backup_${Date.now()}.json`);
        res.json(data);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/settings/revenue
// @desc    Get comprehensive revenue, asset, and trend analysis
router.get('/revenue', async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;
        
        let start, end;
        const now = new Date();
        
        // --- 1. Date Logic ---
        if (period === 'today') {
            start = new Date(now.setHours(0,0,0,0));
            end = new Date(now.setHours(23,59,59,999));
        } else if (period === 'yesterday') {
            const y = new Date(now);
            y.setDate(y.getDate() - 1);
            start = new Date(y.setHours(0,0,0,0));
            end = new Date(y.setHours(23,59,59,999));
        } else if (period === 'this_month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        } else if (period === 'fiscal_year') {
             // Assuming Apr 1 - Mar 31
             const currentMonth = now.getMonth();
             const currentYear = now.getFullYear();
             if (currentMonth >= 3) { // Apr is 3
                 start = new Date(currentYear, 3, 1);
                 end = new Date(currentYear + 1, 2, 31, 23, 59, 59);
             } else {
                 start = new Date(currentYear - 1, 3, 1);
                 end = new Date(currentYear, 2, 31, 23, 59, 59);
             }
        } else if (period === 'custom' && startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
            end.setHours(23,59,59,999);
        } else {
            // All Time
            start = new Date(0);
            end = new Date();
            end.setFullYear(end.getFullYear() + 100);
        }

        const dateFilter = { date: { $gte: start, $lte: end } };

        // --- 2. Summary Metrics (Income/Expense/Profit) ---
        // Income = Total Payment Logs (Actual money received)
        const incomeAgg = await PaymentLog.aggregate([
            { $match: dateFilter },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const income = incomeAgg[0]?.total || 0;

        // Expense = Purchases in this period
        const expenseAgg = await Purchase.aggregate([
            { $match: dateFilter },
            { $group: { _id: null, total: { $sum: "$grandTotal" } } }
        ]);
        const expense = expenseAgg[0]?.total || 0;

        // --- 3. Revenue Sources (Retail vs Wholesale vs Whole Chili) ---
        const revenueSourceAgg = await PaymentLog.aggregate([
            { $match: dateFilter },
            { $group: { _id: "$type", total: { $sum: "$amount" } } }
        ]);
        
        let retailRevenue = 0;
        let wholesaleRevenue = 0;
        let wholeChiliRevenue = 0;

        revenueSourceAgg.forEach(r => {
            if(r._id === 'Wholesale') {
                wholesaleRevenue += r.total;
            } else if (r._id === 'Retail - Whole') {
                wholeChiliRevenue += r.total;
            } else {
                retailRevenue += r.total; // 'Retail' or legacy nulls
            }
        });
        
        const revenueSources = [
            { name: 'Retail', value: retailRevenue },
            { name: 'Wholesale', value: wholesaleRevenue },
            { name: 'Whole Chili', value: wholeChiliRevenue }
        ];

        // --- 4. Trends (Sales Weight by Spice) ---
        // Use daily grouping for periods <= 31 days, monthly for longer
        const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
        const dateFormat = daysDiff > 32 ? "%Y-%m" : "%Y-%m-%d";

        const saleTrendsAgg = await Sale.aggregate([
            { $match: dateFilter },
            { $unwind: "$items" },
            { $group: {
                _id: {
                    date: { $dateToString: { format: dateFormat, date: "$date" } },
                    spice: "$items.name"
                },
                totalQty: { $sum: "$items.quantityKg" }
            }},
            { $sort: { "_id.date": 1 } }
        ]);

        const trendMap = {};
        const trendKeysSet = new Set();

        saleTrendsAgg.forEach(item => {
            const date = item._id.date;
            const spice = item._id.spice;
            const qty = item.totalQty;

            if (!trendMap[date]) {
                trendMap[date] = { date };
            }
            trendMap[date][spice] = qty;
            trendKeysSet.add(spice);
        });
        
        const trends = Object.values(trendMap).sort((a,b) => a.date.localeCompare(b.date));
        const trendKeys = Array.from(trendKeysSet);

        // --- 5. Assets Valuation (Snapshot - Current State) ---
        // Outstanding Dues Only
        
        // Retail: Type NOT 'Wholesale' and NOT 'Retail - Whole'
        const retailDuesAgg = await Sale.aggregate([
            { $match: { 
                borrowing: { $gt: 0 }, 
                type: { $nin: ['Wholesale', 'Retail - Whole'] } 
            }},
            { $group: { _id: null, total: { $sum: "$borrowing" } } }
        ]);
        
        // Wholesale: Type 'Wholesale'
        const wholesaleDuesAgg = await Sale.aggregate([
            { $match: { borrowing: { $gt: 0 }, type: 'Wholesale' } },
            { $group: { _id: null, total: { $sum: "$borrowing" } } }
        ]);

        // Whole Chili: Type 'Retail - Whole'
        const wholeChiliDuesAgg = await Sale.aggregate([
            { $match: { borrowing: { $gt: 0 }, type: 'Retail - Whole' } },
            { $group: { _id: null, total: { $sum: "$borrowing" } } }
        ]);

        const retailDues = retailDuesAgg[0]?.total || 0;
        const wholesaleDues = wholesaleDuesAgg[0]?.total || 0;
        const wholeChiliDues = wholeChiliDuesAgg[0]?.total || 0;

        // --- 6. Product Performance ---
        // Analyze sales in the selected period
        const salesInPeriod = await Sale.aggregate([
            { $match: dateFilter },
            { $unwind: "$items" },
            { $group: {
                _id: "$items.spiceId",
                name: { $first: "$items.name" },
                totalRevenue: { $sum: "$items.total" },
                totalQty: { $sum: "$items.quantityKg" }
            }}
        ]);

        const productPerformance = salesInPeriod.map(p => ({
            id: p._id,
            name: p.name,
            revenue: p.totalRevenue,
            qty: p.totalQty
        }));

        const topProducts = [...productPerformance].sort((a,b) => b.revenue - a.revenue).slice(0, 5);

        // --- 7. Recent Transactions (Activity Feed) ---
        const [recentSales, recentPurchases, recentPayments] = await Promise.all([
            Sale.find().sort({date: -1}).limit(10).populate('customer', 'name').lean(),
            Purchase.find().sort({date: -1}).limit(10).lean(),
            PaymentLog.find().sort({date: -1}).limit(10).populate('customer', 'name').lean()
        ]);

        let transactions = [];
        recentSales.forEach(s => transactions.push({ 
            date: s.date, type: 'Sale', 
            name: s.customer?.name || 'Unknown', 
            amount: s.finalTotal, 
            details: `#${s.billNumber}` 
        }));
        recentPurchases.forEach(p => transactions.push({ 
            date: p.date, type: 'Purchase', 
            name: p.vendorName, 
            amount: p.grandTotal, 
            details: `${p.items.length} items` 
        }));
        recentPayments.forEach(p => transactions.push({ 
            date: p.date, type: 'Payment', 
            name: p.customer?.name || 'Unknown', 
            amount: p.amount, 
            details: p.type 
        }));

        transactions.sort((a,b) => new Date(b.date) - new Date(a.date));
        transactions = transactions.slice(0, 10);

        res.json({
            summary: { 
                income, 
                expense, 
                profit: income - expense 
            },
            trends,
            trendKeys,
            revenueSources,
            assets: { 
                retailDues, 
                wholesaleDues, 
                wholeChiliDues,
                totalAssets: retailDues + wholesaleDues + wholeChiliDues 
            },
            topProducts,
            recentTransactions: transactions
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
