# Key-Value Store Project

A high-performance, scalable key-value data store with Create, Read, and Delete (CRD) operations, designed to run in a Node.js and Express environment. This data store is structured for single-process use, offering JSON-based data persistence and batch creation capabilities.

![Screenshot 2024-11-03 184941](https://github.com/user-attachments/assets/b5f29318-3c03-4219-8adf-0961b49d0416)



## Table of Contents
- [Features](#features)
- [Installation Instructions](#installation-instructions)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [Design Decisions](#design-decisions)

---

## Features
- **CRD Operations**: Supports create, read, and delete operations on key-value pairs.
- **Batch Operations**: Allows creating multiple key-value pairs in a single call.
- **TTL (Time-to-Live)**: Optional TTL for each key, making keys unavailable after expiry.
- **File-based Persistence**: Data is stored as JSON files.
- **Concurrency and Thread Safety**: Thread-safe operations to prevent data conflicts.

## **Installation Instructions**

### 1. **Clone the Repository**

```bash
git clone https://github.com/KALYAN1045/key-value-pairs
cd key-value-pairs
```

### 2. **Install Dependencies**

#### **Backend**

```bash
cd backend
npm install
```

#### **Frontend**

```bash
cd ../frontend
npm install
```


## Running the Application

### Locally

1. **Start the Server**:

#### **Backend**

```bash
cd backend
npm start
```
The server will run on [http://localhost:5000](http://localhost:5000).
 
#### **Frontend**

```bash
cd ../frontend
npm start
```

The server will run on [http://localhost:3000](http://localhost:3000).
  

## API Endpoints

| Method | Endpoint               | Description                                  |
| ------ | -----------------------| -------------------------------------------- |
| POST   | `/api/kv`              | Creates a key-value pair.                    |
| GET    | `/api/kv/:key`         | Retrieves the value associated with a key.   |
| DELETE | `/api/kv/:key`         | Deletes a key-value pair by key.             |
| POST   | `/api/kv/batch`        | Creates multiple key-value pairs in a batch. |

### Example Requests

1. **Create Key-Value Pair**:

    ```http
    POST /api/kv
    Content-Type: application/json

    {
      "key": "user1",
      "value": {"name": "Alice"},
      "ttl": 120
    }
    ```

2. **Read Key-Value Pair**:

    ```http
    GET /api/kv/user1
    ```

3. **Batch Create Key-Value Pairs**:

    ```http
    POST /api/kv/batch
    Content-Type: application/json

    {
      "items": [
        ["user1", {"name": "Alice"}, 120],
        ["user2", {"name": "Bob"}, 300]
      ]
    }
    ```

## Testing

1. **Run Tests**:

    ```bash
    npm test
    ```

2. **Test Coverage**:
   To view test coverage:

    ```bash
    npm run test:coverage
    ```

3. **Testing with Supertest**:
   - The tests use **Jest** and **Supertest** to ensure endpoint functionality, covering edge cases like invalid keys, TTL expirations, and batch handling.

## Design Decisions

- **File-based Storage**: Originally designed with file-based JSON storage for simplicity and local persistence. This approach is suitable for single-process, low-data applications but does not support scaling or distributed access.
- **Concurrency and Locking**: Implemented basic locking mechanisms to prevent data conflicts when accessing keys simultaneously. Thread-safety is achieved by locking each key during updates.

## System Dependencies and Limitations

1. **Dependencies**:
   - **Express**: Serves as the HTTP server.
   - **Mongoose (Optional)**: For MongoDB support if persistent storage is needed.
   - **Proper-lockfile**: Ensures safe concurrent access by locking files.

2. **Operating System Compatibility**:
   - This project is compatible with major OSs: **Windows**, **Linux**, and **macOS**.
   - For file-based persistence, system paths and access permissions may vary. The default path uses the user's home directory to enhance compatibility across OSs.

3. **Limitations**:
   - **Ephemeral Storage on Vercel**: Vercel’s serverless functions do not support persistent file storage, requiring an external database like MongoDB for permanent storage.
   - **Memory Constraints**: For large datasets, file-based storage becomes impractical due to memory limitations. MongoDB or other databases are recommended for scalability.
