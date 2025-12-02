
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true 
  },
  mobileNumber: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  address: {
    type: String,
  },
  creditLimit: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  tags: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('customer', CustomerSchema);
