
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('../models/Customer');
require('../models/Sale');
require('../models/PaymentLog');
require('../models/Spice'); // Import Spice model

const Customer = mongoose.model('customer');
const Sale = mongoose.model('sale');
const PaymentLog = mongoose.model('paymentLog');
const Spice = mongoose.model('spice'); // Define Spice model


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

// @route   POST api/customers/add
// @desc    Manually add a new customer
// @access  Public
router.post('/add', async (req, res) => {
  const { name, mobileNumber, address, notes, category } = req.body;

  if (!name || !mobileNumber) {
    return res.status(400).json({ msg: 'Name and Mobile Number are required.' });
  }

  if (mobileNumber.length !== 10) {
    return res.status(400).json({ msg: 'Mobile number must be 10 digits.' });
  }

  try {
    let customer = await Customer.findOne({ mobileNumber });
    if (customer) {
      return res.status(400).json({ msg: 'Customer with this mobile number already exists.' });
    }

    const customerData = {
      name,
      mobileNumber,
      address,
      notes
    };

    if (category) {
        // Store category in tags
        customerData.tags = [category];
    }

    customer = new Customer(customerData);

    await customer.save();
    res.json({ msg: 'Customer added successfully', customer });
  } catch (err) {
    console.error(err.message);
    // Return JSON error instead of text for better frontend handling
    res.status(500).json({ msg: 'Server Error: ' + err.message });
  }
});

// @route   DELETE api/customers/:id
// @desc    Delete a customer AND their sales/payment history AND restore stock
// @access  Public
router.delete('/:id', async (req, res) => {
  try {
    const customerId = req.params.id;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ msg: 'Customer not found' });
    }

    // 1. Find all Sales associated with this customer
    const sales = await Sale.find({ customer: customerId });

    // 2. Revert stock for each sale (Add sold items back to inventory)
    for (const sale of sales) {
        if (sale.items && Array.isArray(sale.items)) {
            for (const item of sale.items) {
                // Only restore stock if the sale wasn't cancelled (though cancelled sales usually don't deduct stock, 
                // or are handled separately, assuming standard sales here deduct stock)
                if (!sale.cancelled) {
                    await Spice.updateOne(
                        { id: item.spiceId },
                        { $inc: { stock: item.quantityKg } }
                    );
                }
            }
        }
    }

    // 3. Delete all Sales associated with this customer
    await Sale.deleteMany({ customer: customerId });

    // 4. Delete all Payment Logs associated with this customer
    await PaymentLog.deleteMany({ customer: customerId });

    // 5. Delete the Customer record
    await Customer.findByIdAndDelete(customerId);

    res.json({ msg: 'Customer deleted, sales history removed, and stock restored successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error: ' + err.message });
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
    const typeFilter = req.query.type; 
    
    const matchCondition = { 
        borrowing: { $gt: 0 },
        cancelled: { $ne: true } 
    };

    const pipeline = [
      { $match: matchCondition },
      { $sort: { date: -1 } },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerInfo'
        }
      },
      {
        $unwind: {
          path: '$customerInfo',
          preserveNullAndEmptyArrays: true 
        }
      },
      {
        $project: {
          'customerInfo.createdAt': 0, 
          'customerInfo.__v': 0,
        }
      },
      { $addFields: { customer: '$customerInfo' } },
      { $project: { customerInfo: 0 } }
    ];

    if (typeFilter) {
      const matchStage = pipeline[0].$match;
      if (typeFilter === 'Retail') {
          matchStage.type = { $nin: ['Wholesale', 'Retail - Whole'] };
      } else if (typeFilter === 'WholeChili') {
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
      { $match: { 
          borrowing: { $gt: 0 }, 
          type: { $in: ['Wholesale', 'Retail - Whole'] },
          cancelled: { $ne: true }
      }},
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'cust'
        }
      },
      { $unwind: '$cust' },
      {
        $group: {
          _id: '$cust._id',
          customerName: { $first: '$cust.name' },
          mobileNumber: { $first: '$cust.mobileNumber' },
          totalDue: { $sum: '$borrowing' },
          salesCount: { $sum: 1 },
          types: { $addToSet: '$type' }
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
// @desc    Get detailed ledger (Sales + Payments) for a customer
// @access  Public
router.get('/ledger/:customerId', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { customerId } = req.params;
    const { type } = req.query; 

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ msg: 'Customer not found' });

    const saleQuery = { 
        customer: customerId,
        cancelled: { $ne: true }
    };
    if (type) {
        if (type === 'Retail') {
            saleQuery.type = { $nin: ['Wholesale', 'Retail - Whole'] };
        } else {
            saleQuery.type = type;
        }
    }
    const sales = await Sale.find(saleQuery).lean();

    const paymentQuery = { customer: customerId };
    if (type) {
        if (type === 'Retail') {
            paymentQuery.type = { $nin: ['Wholesale', 'Retail - Whole'] };
        } else {
            paymentQuery.type = type;
        }
    }
    const payments = await PaymentLog.find(paymentQuery).lean();

    const salesTotal = sales.reduce((acc, sale) => acc + (sale.borrowing || 0), 0);
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
// @desc    Record a lump sum payment
// @access  Public
router.post('/wholesale/pay', async (req, res) => {
  const { customerId, amount } = req.body;

  if (!customerId || !amount || amount <= 0) {
    return res.status(400).json({ msg: 'Customer ID and valid amount required.' });
  }

  try {
    const sales = await Sale.find({ 
      customer: customerId, 
      borrowing: { $gt: 0 },
      type: { $in: ['Wholesale', 'Retail - Whole'] },
      cancelled: { $ne: true }
    }).sort({ date: 1 });

    let remainingPayment = Number(amount);
    let paidSalesCount = 0;

    for (const sale of sales) {
      if (remainingPayment <= 0) break;

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
// @desc    Settle a due for a specific sale
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
    if (sale.cancelled) {
        return res.status(400).json({ msg: 'Cannot settle due for a cancelled sale.' });
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
      { new: true }
    );

    const log = new PaymentLog({
        customer: sale.customer,
        amount: paymentAmount,
        note: `Retail Settle Due for Sale ID: ${saleId}`,
        type: sale.type || 'Retail'
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
// @desc    Update customer details
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
