const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const db = process.env.MONGO_URI;

    if (!db) {
        throw new Error("MONGO_URI is not defined in environment variables.");
    }

    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected to Atlas...');
  } catch (err) {
    console.error(err.message);
    // Exit process with failure
    process.exit(1);
  }
};

module.exports = connectDB;