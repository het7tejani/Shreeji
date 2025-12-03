
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Sale');
require('../models/Spice');
require('../models/PaymentLog');

const Sale = mongoose.model('sale');
const Spice = mongoose.model('spice');
const PaymentLog = mongoose.model('paymentLog');

// @route   GET api/sales
// @desc    Get recent sales history (global)
// @access  Public
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const sales = await Sale.find().sort({ date: -1 }).limit(50).populate('customer', 'name mobileNumber');
    res.json(sales);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/sales/delete
// @desc    Delete a sale and its payment logs, and restore stock
// @access  Protected
router.delete('/delete', async (req, res) => {
    const { id, billNumber } = req.query;
    console.log(`[DELETE SALE] Request -> ID: ${id}, Bill: ${billNumber}`);

    try {
        let sale = null;

        // --- STRATEGY 1: Standard Lookup ---
        if (id && mongoose.Types.ObjectId.isValid(id)) {
            sale = await Sale.findById(id);
        }

        // --- STRATEGY 2: Bill Number Lookup ---
        if (!sale && billNumber) {
             // Try Number then String
             sale = await Sale.findOne({ billNumber: parseInt(billNumber) });
             if (!sale) {
                 sale = await Sale.findOne({ billNumber: billNumber.toString() });
             }
        }

        // --- STRATEGY 3: MEMORY SCAN (The Fail-Safe) ---
        if (!sale) {
            console.log("[DELETE SALE] DB lookup failed. Starting Memory Scan...");
            const allSales = await Sale.find().sort({ date: -1 }).limit(500);
            
            sale = allSales.find(s => {
                const sId = String(s._id);
                const sBill = s.billNumber ? String(s.billNumber) : '';
                const reqId = id ? String(id) : '';
                const reqBill = billNumber ? String(billNumber) : '';

                return (reqId && sId === reqId) || (reqBill && sBill === reqBill);
            });
        }

        if (!sale) {
            console.log("[DELETE SALE] Failed to find record.");
            return res.status(404).json({ msg: `Record not found. Searched ID: ${id}, Bill: ${billNumber}` });
        }

        console.log(`[DELETE SALE] Found Record: ${sale._id} (Bill: ${sale.billNumber})`);

        // --- RESTORE STOCK ---
        // Since we are deleting a sale, we must put the items BACK into stock
        if (sale.items && sale.items.length > 0) {
            for (const item of sale.items) {
                await Spice.updateOne(
                    { id: item.spiceId },
                    { $inc: { stock: item.quantityKg } }
                );
            }
            console.log(`[DELETE SALE] Stock restored for ${sale.items.length} items.`);
        }

        // --- DELETE PAYMENT LOGS ---
        const saleId = sale._id;
        const deleteResult = await PaymentLog.deleteMany({ 
            $or: [
                { saleId: saleId }, 
                { saleId: saleId.toString() } 
            ] 
        });
        console.log(`[DELETE SALE] Payment Logs Deleted: ${deleteResult.deletedCount}`);

        // --- DELETE SALE ---
        await Sale.findByIdAndDelete(saleId);
        console.log(`[DELETE SALE] Document Deleted.`);

        res.json({ msg: 'Record deleted and stock restored successfully.' });

    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).json({ msg: err.message });
    }
});

module.exports = router;
