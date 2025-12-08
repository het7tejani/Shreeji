
const mongoose = require('mongoose');

const PurchaseItemSchema = new mongoose.Schema({
  spiceId: { type: Number, required: true },
  spiceName: { type: String, required: true },
  quantityKg: { type: Number, required: true },
  pricePerKg: { type: Number, required: true },
  total: { type: Number, required: true }
}, { _id: false });

const PurchaseSchema = new mongoose.Schema({
  vendorName: { 
    type: String, 
    required: true 
  },
  vendorMobile: { 
    type: String 
  },
  vendorAddress: {
    type: String
  },
  items: [PurchaseItemSchema],
  grandTotal: {
    type: Number,
    required: true
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  balance: {
    type: Number,
    default: 0
  },
  cancelled: {
    type: Boolean,
    default: false
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('purchase', PurchaseSchema);
