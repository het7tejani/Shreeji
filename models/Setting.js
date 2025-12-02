const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // Stores password hash for 'password' key, or other values for other keys
  value: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model('setting', SettingSchema);