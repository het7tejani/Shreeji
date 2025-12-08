
const mongoose = require('mongoose');

const PaymentLogSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'customer',
    required: true
  },
  saleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'sale'
  },
  amount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String,
    default: 'Wholesale Payment (Cut)'
  },
  type: {
    type: String,
    enum: ['Retail', 'રીટેઈલ', 'Wholesale', 'Retail - Whole'],
    default: 'Retail'
  }
});

module.exports = mongoose.model('paymentLog', PaymentLogSchema);