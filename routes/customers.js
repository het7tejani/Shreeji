
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Customer');
require('../models/Sale');
require('../models/PaymentLog');

const Customer = mongoose.model('customer');
const Sale = mongoose.model('sale');
const PaymentLog = mongoose.model('paymentLog');


// @route   GET api/customers
// @desc    Get all customers
// @access  Public
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const customers = await Customer.find().sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/customers/lookup/:mobileNumber
// @desc    Find a customer by mobile number
// @access  Public
router.get('/lookup/:mobileNumber', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const customer = await Customer.findOne({ mobileNumber: req.params.mobileNumber });
    if (!customer) {
      return res.status(404).json({ msg: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/customers/sales/:mobileNumber
// @desc    Get sales history for a customer by mobile number
// @access  Public
router.get('/sales/:mobileNumber', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const customer = await Customer.findOne({ mobileNumber: req.params.mobileNumber });
    if (!customer) {
      return res.status(404).json({ msg: 'Customer not found' });
    }

    const sales = await Sale.find({ customer: customer._id }).sort({ date: -1 });
    res.json(sales);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/customers/dues
// @desc    Get all sales with outstanding dues (supports filtering by type)
// @access  Public
router.get('/dues', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const typeFilter = req.query.type; // 'Retail', 'WholeChili', or 'Wholesale'
    
    // Using a more robust aggregation pipeline instead of populate
    const pipeline = [
      { $match: { borrowing: { $gt: 0 } } },
      { $sort: { date: -1 } },
      {
        $lookup: {
          from: 'customers', // The actual collection name for the 'customer' model
          localField: 'customer',
          foreignField: '_id',
          as: 'customerInfo'
        }
      },
      {
        $unwind: {
          path: '$customerInfo',
          preserveNullAndEmptyArrays: true // Keep sale even if customer is not found
        }
      },
      {
        $project: {
          'customerInfo.createdAt': 0, // Exclude fields if necessary
          'customerInfo.__v': 0,
        }
      },
      // Rename 'customerInfo' to 'customer' to match frontend expectation
      { $addFields: { customer: '$customerInfo' } },
      { $project: { customerInfo: 0 } }
    ];

    // If filtering by type (e.g., only Retail), apply to SALES, not customer tags
    if (typeFilter) {
      const matchStage = pipeline[0].$match;
      if (typeFilter === 'Retail') {
          // For Retail, include items explicitly marked Retail OR legacy items with no type
          // BUT exclude 'Retail - Whole' which is now its own category
          matchStage.type = { $nin: ['Wholesale', 'Retail - Whole'] };
      } else if (typeFilter === 'WholeChili') {
          // Specific filter for Whole Chili
          matchStage.type = 'Retail - Whole';
      } else {
          matchStage.type = typeFilter;
      }
    }

    const salesWithDues = await Sale.aggregate(pipeline);

    res.json(salesWithDues);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/customers/wholesale/summary
// @desc    Get aggregated dues for wholesale and whole chili customers
// @access  Public
router.get('/wholesale/summary', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    
    const summary = await Sale.aggregate([
      // 1. Only sales with borrowing AND Type='Wholesale' or 'Retail - Whole'
      { $match: { borrowing: { $gt: 0 }, type: { $in: ['Wholesale', 'Retail - Whole'] } } },
      // 2. Lookup customer
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'cust'
        }
      },
      { $unwind: '$cust' },
      // 3. Group by customer and sum borrowing
      {
        $group: {
          _id: '$cust._id',
          customerName: { $first: '$cust.name' },
          mobileNumber: { $first: '$cust.mobileNumber' },
          totalDue: { $sum: '$borrowing' },
          salesCount: { $sum: 1 },
          types: { $addToSet: '$type' } // Collect unique types for this customer
        }
      },
      { $sort: { customerName: 1 } }
    ]);

    res.json(summary);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/customers/ledger/:customerId
// @desc    Get detailed ledger (Sales + Payments) for a customer, filtered by type
// @access  Public
router.get('/ledger/:customerId', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { customerId } = req.params;
    const { type } = req.query; // 'Retail' or 'Wholesale'

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ msg: 'Customer not found' });

    // Filter Sales
    const saleQuery = { customer: customerId };
    if (type) {
        if (type === 'Retail') {
            saleQuery.type = { $nin: ['Wholesale', 'Retail - Whole'] }; // Exclude Wholesale AND Whole Chili
        } else {
            saleQuery.type = type;
        }
    }
    const sales = await Sale.find(saleQuery).lean();

    // Filter Payments
    const paymentQuery = { customer: customerId };
    if (type) {
        if (type === 'Retail') {
            // Include payments explicitly Retail OR payments with no type (legacy)
            paymentQuery.type = { $nin: ['Wholesale', 'Retail - Whole'] };
        } else {
            paymentQuery.type = type;
        }
    }
    const payments = await PaymentLog.find(paymentQuery).lean();

    // Calculate current total due based on filtered lists
    const salesTotal = sales.reduce((acc, sale) => acc + (sale.borrowing || 0), 0);
    // Note: 'borrowing' in Sale already accounts for initial payment.
    
    const totalDue = salesTotal;

    res.json({
      customer,
      sales,
      payments,
      totalDue
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/customers/wholesale/pay
// @desc    Record a lump sum payment for a wholesaler/whole chili and distribute it across old sales
// @access  Public
router.post('/wholesale/pay', async (req, res) => {
  const { customerId, amount } = req.body;

  if (!customerId || !amount || amount <= 0) {
    return res.status(400).json({ msg: 'Customer ID and valid amount required.' });
  }

  try {
    // 1. Get all unpaid WHOLESALE or WHOLE CHILI sales for this customer, oldest first
    const sales = await Sale.find({ 
      customer: customerId, 
      borrowing: { $gt: 0 },
      type: { $in: ['Wholesale', 'Retail - Whole'] }
    }).sort({ date: 1 });

    let remainingPayment = Number(amount);
    let paidSalesCount = 0;

    // 2. Distribute payment
    for (const sale of sales) {
      if (remainingPayment <= 0) break;

      // How much can we pay off this sale?
      let payOffAmount = 0;
      
      if (remainingPayment >= sale.borrowing) {
        payOffAmount = sale.borrowing;
      } else {
        payOffAmount = remainingPayment;
      }

      sale.borrowing -= payOffAmount;
      sale.amountToPay += payOffAmount;
      remainingPayment -= payOffAmount;
      
      await sale.save();
      paidSalesCount++;
    }

    // 3. Log the payment as Wholesale (generic type for this dashboard)
    const log = new PaymentLog({
      customer: customerId,
      amount: Number(amount),
      note: `Bulk Payment (Wholesale/Whole Cut)`,
      type: 'Wholesale'
    });
    await log.save();

    res.json({ 
      msg: 'Payment recorded and distributed successfully', 
      remainingBalance: remainingPayment 
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/customers/settle-due
// @desc    Settle a due for a specific sale (Retail)
// @access  Public
router.post('/settle-due', async (req, res) => {
  const { saleId, amount } = req.body;
  
  if (!saleId || amount == null || amount <= 0) {
    return res.status(400).json({ msg: 'Sale ID and a valid positive amount are required.' });
  }

  try {
    const sale = await Sale.findById(saleId);
    if (!sale) {
      return res.status(404).json({ msg: 'Sale not found.' });
    }

    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount)) {
      return res.status(400).json({ msg: 'Invalid payment amount.' });
    }
    
    if (paymentAmount > sale.borrowing + 0.001) {
      return res.status(400).json({ msg: `Payment amount cannot be greater than the due amount of ${sale.borrowing.toFixed(2)}.` });
    }

    const updatedSale = await Sale.findByIdAndUpdate(
      saleId,
      {
        $inc: {
          borrowing: -paymentAmount,
          amountToPay: paymentAmount
        }
      },
      { new: true } // Return the updated document
    );

    // Log this as a Retail payment
    const log = new PaymentLog({
        customer: sale.customer,
        amount: paymentAmount,
        note: `Retail Settle Due for Sale ID: ${saleId}`,
        type: sale.type || 'Retail' // Keep original type
    });
    await log.save();

    res.json(updatedSale);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
        return res.status(404).json({ msg: 'Sale not found.' });
    }
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/customers/:id
// @desc    Update customer details (notes, credit limit)
// @access  Public
router.put('/:id', async (req, res) => {
  const { notes, creditLimit } = req.body;
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { $set: { notes, creditLimit } },
      { new: true }
    );
    if (!customer) {
      return res.status(404).json({ msg: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


module.exports = router;
