
const mongoose = require('mongoose');

const SaleItemSchema = new mongoose.Schema({
  spiceId: { type: Number, required: true },
  name: { type: String, required: true },
  quantityKg: { type: Number, required: true }, // This is Net Weight
  grossWeight: { type: Number }, // Added Gross Weight
  bardan: { type: Number },      // Added Bag Weight deduction
  amountPerKg: { type: Number, required: true },
  total: { type: Number, required: true },
  bags: { type: Number, default: 0 }
}, { _id: false });

const SaleSchema = new mongoose.Schema({
  customer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'customer', 
    required: true,
    index: true // Indexed for faster lookup by customer
  },
  billNumber: {
    type: Number
  },
  items: [SaleItemSchema],
  subTotal: {
    type: Number,
    required: true,
    default: 0
  },
  labor: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  finalTotal: { 
    type: Number, 
    required: true 
  },
  borrowing: { 
    type: Number, 
    default: 0 
  },
  amountToPay: { 
    type: Number, 
    required: true 
  },
  type: {
    type: String,
    enum: ['Retail', 'Wholesale', 'Retail - Whole'],
    default: 'Retail',
    index: true
  },
  cancelled: {
    type: Boolean,
    default: false,
    index: true
  },
  date: { 
    type: Date, 
    default: Date.now,
    index: true // Indexed for sorting and date range queries
  }
});

// Compound index for querying dues efficiently
SaleSchema.index({ borrowing: 1, date: -1 });
SaleSchema.index({ billNumber: -1 });

module.exports = mongoose.model('sale', SaleSchema);