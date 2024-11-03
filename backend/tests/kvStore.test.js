const KVStore = require("../src/kvStore");
console.log(typeof KVStore);
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

describe("KVStore", () => {
  let store;
  let testFilePath;

  beforeEach(async () => {
    testFilePath = path.join(os.tmpdir(), `test-kvstore-${Date.now()}.json`);
    store = new KVStore(testFilePath, { maxFileSize: 1024 * 1024 }); 
    await store.initialize();
  });

  afterEach(async () => {
    try {
      await fsp.unlink(testFilePath);
    } catch (error) {
    }
  });

  describe("Initialization", () => {
    test("should initialize with custom file path", async () => {
      const customPath = path.join(
        os.tmpdir(),
        `custom-store-${Date.now()}.json`
      );
      const customStore = new KVStore(customPath);
      await customStore.initialize();
      expect(customStore.filePath).toBe(customPath);

      // Ensure file exists before attempting to delete
      try {
        await fsp.access(customPath);
        await fsp.unlink(customPath);
      } catch (error) {
      }
    });

    test("should initialize with default file path if none provided", async () => {
      const defaultStore = new KVStore();
      await defaultStore.initialize();
      expect(defaultStore.filePath).toBe(
        path.join(os.homedir(), ".kvstore.json")
      );
    });
  });

  describe("Key-Value Operations", () => {
    test("should create and read a key-value pair", async () => {
      const key = "test";
      const value = { data: "test value" };
      await store.create(key, value);
      const result = await store.read(key);
      expect(result).toEqual(value);
    });

    test("should delete a key-value pair", async () => {
      const key = "test";
      const value = { data: "test value" };
      await store.create(key, value);
      await store.delete(key);
      await expect(store.read(key)).rejects.toThrow("Key not found");
    });

    test("should handle TTL expiration", async () => {
      const key = "ttl-test";
      const value = { data: "expiring value" };
      await store.create(key, value, 1); 

      const immediate = await store.read(key);
      expect(immediate).toEqual(value);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      await expect(store.read(key)).rejects.toThrow("Key not found");
    });
  });

  describe("Constraints", () => {
    test("should enforce key length limit", async () => {
      const longKey = "a".repeat(33);
      await expect(store.create(longKey, { data: "test" })).rejects.toThrow(
        "Key cannot exceed 32 characters"
      );
    });

    test("should enforce value size limit", async () => {
      const largeValue = { data: "x".repeat(16 * 1024 + 1) };
      await expect(store.create("test", largeValue)).rejects.toThrow(
        "Value size cannot exceed 16KB"
      );
    });

    test("should prevent duplicate keys", async () => {
      await store.create("test", { data: "original" });
      await expect(store.create("test", { data: "duplicate" })).rejects.toThrow(
        "Key already exists"
      );
    });
  });

  describe("Batch Operations", () => {
    test("should handle batch create successfully", async () => {
      const items = [
        ["key1", { data: "1" }, null],
        ["key2", { data: "2" }, null],
        ["key3", { data: "3" }, null],
      ];
      const failedKeys = await store.batchCreate(items);
      expect(failedKeys).toHaveLength(0);

      // Verify all items were created
      for (const [key, value] of items) {
        const result = await store.read(key);
        expect(result).toEqual(value);
      }
    });

    test("should enforce batch size limit", async () => {
      const items = Array(1001).fill(["key", { data: "value" }, null]);
      await expect(store.batchCreate(items)).rejects.toThrow(
        "Batch size cannot exceed 1000 items"
      );
    });

    test("should handle partial failures in batch", async () => {
      await store.create("existing", { data: "original" });

      const items = [
        ["existing", { data: "new" }, null], 
        ["new-key", { data: "valid" }, null], 
      ];

      const failedKeys = await store.batchCreate(items);
      expect(failedKeys).toContain("existing");
      expect(failedKeys).toHaveLength(1);
    });
  });

  describe("Concurrency", () => {
    test("should handle concurrent operations safely", async () => {
      const operations = Array(100)
        .fill()
        .map((_, i) => store.create(`key${i}`, { data: `value${i}` }));

      await Promise.all(operations);

      for (let i = 0; i < 100; i++) {
        const result = await store.read(`key${i}`);
        expect(result).toEqual({ data: `value${i}` });
      }
    });

    test("should handle concurrent read/write operations", async () => {
      await store.create("concurrent", { count: 0 });

      const operations = Array(100)
        .fill()
        .map(async () => {
          const value = await store.read("concurrent");
          value.count++;
          await store.delete("concurrent");
          await store.create("concurrent", value);
        });

      await Promise.all(operations);
      const final = await store.read("concurrent");
      expect(final.count).toBe(100);
    });
  });

  describe("File Operations", () => {
    test("should handle file size limit", async () => {
        const singleEntrySize = 15 * 1024;
        const largeValue = { data: "x".repeat(singleEntrySize) };
        
        const maxEntries = Math.floor(store.maxFileSize / singleEntrySize);
        
        for (let i = 0; i < maxEntries; i++) {
          await store.create(`key${i}`, largeValue);
        }

        await expect(store.create('onemore', largeValue)).rejects.toThrow(/exceed.*limit/);
      });
  });

  describe("Error Handling", () => {
    test("should handle file system errors", async () => {
      await store.create("dummy", { data: "dummy" }); 

      await fsp.chmod(testFilePath, 0o444);

      await expect(store.create("test", { data: "value" })).rejects.toThrow();

      await fsp.chmod(testFilePath, 0o644); 
    });
  });
});
