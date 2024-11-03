import React, { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [batchInput, setBatchInput] = useState("");

  const API_URL = "http://localhost:5000/api";

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000); 
      return () => clearTimeout(timer); 
    }
  }, [error]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/kv`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          value: JSON.parse(value),
          ttl: ttl ? parseInt(ttl) : null,
        }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setResult("Created successfully");
      setError(null);
      setKey("");
      setValue("");
      setTtl("");
    } catch (err) {
      if (err.message === "Failed to fetch") {
        setError("Server is not running");
      } else {
        setError(err.message);
      }
      setResult(null);
    }
  };

  const handleRead = async () => {
    try {
      const response = await fetch(`${API_URL}/kv/${key}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setResult(JSON.stringify(data.value, null, 2));
      setError(null);
    } catch (err) {
      if (err.message === "Failed to fetch") {
        setError("Server is not running");
      } else {
        setError(err.message);
      }
      setResult(null);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`${API_URL}/kv/${key}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setResult("Deleted successfully");
      setError(null);
      setKey("");
    } catch (err) {
      if (err.message === "Failed to fetch") {
        setError("Server is not running");
      } else {
        setError(err.message);
      }
      setResult(null);
    }
  };

  const handleBatchCreate = async (e) => {
    e.preventDefault();
    try {
      const items = JSON.parse(batchInput);

      const response = await fetch(`${API_URL}/kv/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      if (data.failedKeys && data.failedKeys.length > 0) {
        setResult(
          `Batch create completed. Failed keys: ${data.failedKeys.join(", ")}`
        );
      } else {
        setResult("Batch created successfully");
      }

      setError(null);
      setBatchInput("");
    } catch (err) {
      if (err.message === "Failed to fetch") {
        setError("Server is not running");
      } else {
        setError(err.message);
      }
      setResult(null);
    }
  };

  return (
    <div className="app">
      <h1>Key-Value Store</h1>

      <div className="main-container">
        <div className="single-operations">
          <h2>Single Operations</h2>

          <form onSubmit={handleCreate} className="form">
            <input
              type="text"
              placeholder="Key (max 32 chars)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={32}
            />

            <textarea
              placeholder="Value (JSON, max 16KB)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />

            <input
              type="number"
              placeholder="TTL (seconds, optional)"
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
            />

            <div className="button-group">
              <button type="submit">Create</button>
              <button type="button" onClick={handleRead}>
                Read
              </button>
              <button type="button" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </form>
        </div>

        <div className="batch-operations">
          <h2>Batch Operations</h2>

          <form onSubmit={handleBatchCreate} className="form">
            <textarea
              placeholder="Batch input (JSON array of [key, value, ttl])"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              className="batch-input"
            />

            <button type="submit">Batch Create</button>
          </form>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {result && <div className="result">{result}</div>}
    </div>
  );
}

export default App;
