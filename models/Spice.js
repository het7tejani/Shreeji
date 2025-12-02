
const mongoose = require('mongoose');

const SpiceSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
    unique: true,
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
  },
  category: {
    type: String,
    enum: ['Ground', 'Whole', 'Aakhu'],
    default: 'Ground'
  }
});

module.exports = mongoose.model('spice', SpiceSchema);
