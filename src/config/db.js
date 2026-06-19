const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
    });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("DB connection error:", err);
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected — retrying..."));
mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected"));

module.exports = connectDB;