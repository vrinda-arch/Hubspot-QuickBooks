const mongoose = require("mongoose");
const dns = require("dns");

// Some routers/ISP DNS servers refuse SRV-record lookups, which breaks
// mongodb+srv:// connections in Node. Force a resolver that answers SRV.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

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