const express = require("express");
const cors = require("cors");
const KVStore = require("../src/kvStore"); // Adjust the path to your kvStore file

const app = express();
const store = new KVStore();

app.use(cors());
app.use(express.json());

// Initialize store
store.initialize().catch(console.error);

// Create endpoint
app.post("/api/kv", async (req, res) => {
  try {
    const { key, value, ttl } = req.body;
    await store.create(key, value, ttl);
    res.status(201).json({ message: "Created successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Batch create endpoint
app.post("/api/kv/batch", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid items format" });
    }
    const failedKeys = await store.batchCreate(items);
    res.status(201).json({
      success: true,
      failedKeys: failedKeys || []
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Read endpoint
app.get("/api/kv/:key", async (req, res) => {
  try {
    const value = await store.read(req.params.key);
    res.json({ value });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Delete endpoint
app.delete("/api/kv/:key", async (req, res) => {
  try {
    await store.delete(req.params.key);
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

module.exports = app;
