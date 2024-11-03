const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const lockfile = require("proper-lockfile");
const stream = require("stream");
const { promisify } = require("util");

const pipeline = promisify(stream.pipeline);

class KVStore {
  /**
   * Initializes the KVStore with options for file path and constraints.
   * @param {string} filePath - Optional file path for storage.
   * @param {object} options - Optional configuration for batch size, file size, etc.
   */
  constructor(filePath = null, options = {}) {
    this.filePath = filePath || path.join(os.homedir(), ".kvstore.json");
    this.data = new Map(); // In-memory store for key-value pairs
    this.lock = new Map(); // Locks for concurrent access control
    this.currentSize = 0; // Tracks the current file size
    this.isDirty = false; // Indicates if data needs to be saved
    this.saveTimeout = null; // Timeout for save debounce
    this.maxBatchSize = options.maxBatchSize || 1000; // Max batch size for batchCreate
    this.maxFileSize = options.maxFileSize || 1024 * 1024 * 1024; // Max file size in bytes (default 1GB)
    this.maxValueSize = 16 * 1024; // Max value size in bytes (default 16KB)
    this.maxKeyLength = 32; // Max key length (default 32 chars)
    this.lockInstance = null; // Instance of file lock
    this.savePromise = null; // Promise for the ongoing save operation
    this.saveQueue = []; // Queue for managing multiple save requests
  }

  /**
   * Initializes the data store, ensuring the storage file exists and loading data into memory.
   */
  async initialize() {
    try {
      // Ensure directory exists
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });

      // Create empty file if it doesn't exist
      try {
        await fsp.access(this.filePath, fs.constants.F_OK);
      } catch (error) {
        if (error.code === "ENOENT") {
          await fsp.writeFile(this.filePath, "{}", "utf8");
        }
      }

      // Acquire lock with retry mechanism to prevent multiple processes from accessing the file
      this.lockInstance = await lockfile.lock(this.filePath, {
        stale: 10000,
        retries: {
          retries: 3,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });

      await this.loadData();
      return this;
    } catch (error) {
      if (error.code === "ELOCKED") {
        throw new Error("File is being used by another process");
      }
      throw error;
    }
  }

  /**
   * Loads data from the storage file into memory, applying TTLs for expired entries.
   */
  async loadData() {
    try {
      const stats = await fsp.stat(this.filePath);

      if (stats.size > this.maxFileSize) {
        throw new Error("Data file exceeds 1GB limit");
      }

      const fileContent = await fsp.readFile(this.filePath, "utf8");

      if (!fileContent.trim()) {
        this.data.clear();
        this.currentSize = 0;
        return;
      }

      const data = JSON.parse(fileContent);
      const now = Date.now();

      this.data.clear();
      this.currentSize = 0;

      Object.entries(data).forEach(([key, item]) => {
        if (!item.expiry || item.expiry > now) {
          this.data.set(key, item);
          this.currentSize += this.estimateEntrySize(key, item.value);
        }
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.currentSize = 0;
    }
  }

  /**
   * Creates a key-value pair in the store with optional TTL. Ensures constraints like file size, key uniqueness.
   * @param {string} key - The key for the value.
   * @param {any} value - The JSON-serializable value to store.
   * @param {number} ttl - Optional time-to-live in seconds for expiry.
   */
  async create(key, value, ttl = null) {
    this.validateKey(key);
    this.validateValue(value);

    const entrySize = this.estimateEntrySize(key, value);

    await this.acquireLock(key);
    try {
      const potentialSize = this.currentSize + entrySize;
      if (potentialSize > this.maxFileSize) {
        throw new Error(
          `Data file would exceed ${this.maxFileSize} bytes limit`
        );
      }

      if (this.data.has(key)) {
        const existing = this.data.get(key);
        if (!existing.expiry || existing.expiry > Date.now()) {
          throw new Error("Key already exists");
        }
      }

      const expiry = ttl ? Date.now() + ttl * 1000 : null;
      this.data.set(key, { value, expiry });
      this.currentSize += entrySize;

      await this.queueSave();
    } catch (error) {
      this.data.delete(key);
      this.currentSize -= entrySize;
      throw error;
    } finally {
      this.releaseLock(key);
    }
  }

  /**
   * Adds the save operation to a queue to ensure sequential saving and prevent conflicts.
   */
  async queueSave() {
    if (!this.savePromise) {
      this.savePromise = this.executeSave();
    }

    try {
      await this.savePromise;
    } catch (error) {
      throw new Error(`Failed to save data: ${error.message}`);
    }
  }

  /**
   * Executes the save operation, processing queued save requests.
   */
  async executeSave() {
    try {
      await this.saveData();
    } finally {
      this.savePromise = null;
      if (this.saveQueue.length > 0) {
        const nextSave = this.saveQueue.shift();
        this.savePromise = this.executeSave()
          .then(nextSave.resolve)
          .catch(nextSave.reject);
      }
    }
  }

  /**
   * Saves the data from memory to the file, ensuring data integrity and respecting the file size limit.
   */
  async saveData() {
    const fileData = {};
    let totalSize = 0;

    for (const [key, value] of this.data.entries()) {
      fileData[key] = value;
      totalSize += this.estimateEntrySize(key, value.value);
    }

    if (totalSize > this.maxFileSize) {
      throw new Error(`Data file would exceed ${this.maxFileSize} bytes limit`);
    }

    const content = JSON.stringify(fileData);
    const tempPath = `${this.filePath}.tmp`;

    try {
      await fsp.writeFile(tempPath, content, "utf8");

      try {
        await fsp.rename(tempPath, this.filePath);
      } catch (renameError) {
        try {
          await fsp.unlink(tempPath);
        } catch (unlinkError) {
          // Ignore unlink errors
        }
        throw renameError;
      }

      this.currentSize = totalSize;
      this.isDirty = false;
    } catch (error) {
      if (error.code === "EACCES") {
        throw new Error(`Permission denied: Cannot write to ${this.filePath}`);
      }
      throw error;
    }
  }

  /**
   * Attempts to acquire a lock for the given key to handle concurrent operations safely.
   */
  async acquireLock(key) {
    const maxAttempts = 100;
    let attempts = 0;

    while (this.lock.get(key)) {
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to acquire lock for key: ${key}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts++;
    }
    this.lock.set(key, true);
  }

  /**
   * Releases the lock for a given key after an operation completes.
   */
  releaseLock(key) {
    this.lock.delete(key);
  }

  /**
   * Estimates the memory size of an entry to enforce the file size limit.
   */
  estimateEntrySize(key, value) {
    return Buffer.from(
      JSON.stringify({
        [key]: {
          value,
          expiry: null,
        },
      })
    ).length;
  }

  /**
   * Cleans up the store by saving data and releasing any locks.
   */
  async cleanup() {
    try {
      clearTimeout(this.saveTimeout);

      if (this.isDirty) {
        await this.saveData();
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
    } finally {
      if (this.lockInstance) {
        try {
          await lockfile.unlock(this.filePath, { lockfile: this.lockInstance });
        } catch (unlockError) {
          console.error("Error releasing lock:", unlockError);
        }
        this.lockInstance = null;
      }
    }
  }

  /**
   * Schedules a save operation with debouncing to avoid frequent disk writes.
   */
  scheduleSave() {
    this.isDirty = true;
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveData().catch(console.error);
    }, 1000); // Debounce for 1 second
  }

  /**
   * Validates the key to ensure it is a string and does not exceed the maximum length.
   */
  validateKey(key) {
    if (typeof key !== "string") {
      throw new Error("Key must be a string");
    }
    if (key.length > this.maxKeyLength) {
      throw new Error("Key cannot exceed 32 characters");
    }
  }

  /**
   * Validates the value to ensure it is within the allowed size.
   */
  validateValue(value) {
    const valueSize = Buffer.from(JSON.stringify(value)).length;
    if (valueSize > this.maxValueSize) {
      throw new Error("Value size cannot exceed 16KB");
    }
  }

  /**
   * Creates multiple key-value pairs in batch. Enforces batch size, file size, and key constraints.
   */
  async batchCreate(items) {
    // Ensure items is an array and does not exceed batch size
    if (!Array.isArray(items)) {
      throw new Error("Items must be an array");
    }
    if (items.length > this.maxBatchSize) {
      throw new Error("Batch size cannot exceed 1000 items");
    }

    const failedKeys = [];
    const validItems = [];
    let totalNewSize = 0;

    // Validate each item and calculate the total size increase
    for (const [key, value, ttl] of items) {
      try {
        // Validate key and value constraints
        this.validateKey(key);
        this.validateValue(value);

        // Estimate the size of this entry
        const entrySize = this.estimateEntrySize(key, value);
        totalNewSize += entrySize;

        // Check if the key already exists and is not expired
        if (this.data.has(key)) {
          const existing = this.data.get(key);
          if (!existing.expiry || existing.expiry > Date.now()) {
            failedKeys.push(key); // Key already exists and is valid, so it fails
            continue;
          }
        }

        // If all validations pass, add to validItems
        validItems.push([key, value, ttl]);
      } catch (error) {
        // Catch validation errors for invalid keys or values
        failedKeys.push(key);
      }
    }

    // Check if adding these items would exceed the file size limit
    if (this.currentSize + totalNewSize > this.maxFileSize) {
      throw new Error("Data file exceeds 1GB limit");
    }

    const locks = new Set();
    try {
      // Acquire locks for each key in validItems
      for (const [key] of validItems) {
        await this.acquireLock(key);
        locks.add(key);
      }

      // Add each valid item to the data store
      for (const [key, value, ttl] of validItems) {
        const expiry = ttl ? Date.now() + ttl * 1000 : null;
        this.data.set(key, { value, expiry });
      }

      // Schedule a save after adding all items
      this.scheduleSave();
    } finally {
      // Release all locks
      for (const key of locks) {
        this.releaseLock(key);
      }
    }

    // Return the list of failed keys for batch feedback
    return failedKeys;
  }

  /**
   * Reads a value by key, checking for existence and expiry.
   */
  async read(key) {
    this.validateKey(key);

    await this.acquireLock(key);
    try {
      const item = this.data.get(key);
      if (!item) {
        throw new Error("Key not found");
      }

      if (item.expiry && item.expiry <= Date.now()) {
        this.data.delete(key);
        this.scheduleSave();
        throw new Error("Key not found (expired)");
      }

      return item.value;
    } finally {
      this.releaseLock(key);
    }
  }

  /**
   * Deletes a key-value pair from the store, respecting TTL if set.
   */
  async delete(key) {
    this.validateKey(key);

    await this.acquireLock(key);
    try {
      const item = this.data.get(key);
      if (!item) {
        throw new Error("Key not found");
      }

      if (item.expiry && item.expiry <= Date.now()) {
        this.data.delete(key);
        this.scheduleSave();
        throw new Error("Key not found (expired)");
      }

      this.data.delete(key);
      this.scheduleSave();
    } finally {
      this.releaseLock(key);
    }
  }

  /**
   * Compacts the data store by removing expired keys and saving updated data to file.
   */
  async compact() {
    await this.acquireLock("compact");
    try {
      const now = Date.now();
      for (const [key, item] of this.data.entries()) {
        if (item.expiry && item.expiry <= now) {
          this.data.delete(key);
        }
      }
      await this.saveData();
    } finally {
      this.releaseLock("compact");
    }
  }
}

module.exports = KVStore;

process.on("exit", async () => {
  if (global.kvStore) {
    await global.kvStore.cleanup();
  }
});
