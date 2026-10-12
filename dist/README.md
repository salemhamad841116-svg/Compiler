# Private Gemini-Powered RAG Assistant (Backend)

A private AI assistant backend powered by Google Gemini and a vector retrieval pipeline. The application is strictly constrained to your personal book collection—ensuring answers are grounded in your source material without hallucinations or outside training data.

---

## 🏗️ Architecture Overview

```mermaid
flowchart TD
    subgraph Ingestion Pipeline
        A[PDF Book File] --> B[API Router /api/ingestion/upload-book]
        B --> C[PDF Parser & Text Extractor]
        C --> D[Text Chunker with Overlap]
        D --> E[Gemini text-embedding-004]
        E --> F[(Vector Database / Store)]
    end

    subgraph Chat / Query Pipeline
        G[User Question] --> H[API Router /api/chat/query]
        H --> I[Query Embedding Generator]
        I --> J[Cosine Similarity Search]
        F --> J
        J --> K[Relevant Book Context Chunks]
        K --> L[Gemini LLM with Strict System Prompt]
        G --> L
        L --> M[Factual Answer / Explicit Fallback]
    end
```

---

## 📁 Project Structure

```
.
├── .env.example                # Sample environment variables
├── package.json                # Project dependencies & npm scripts
├── README.md                   # Documentation & developer guide
├── data/                       # Local vector store storage (auto-generated)
├── uploads/                    # Temporary book upload directory (auto-cleaned)
└── src/
    ├── server.js               # Express application entrypoint
    ├── controllers/
    │   ├── ingestionController.js   # PDF upload, chunking, and embedding controller
    │   └── chatController.js        # User question handling and semantic search controller
    ├── models/
    │   └── vectorDbModel.js         # Vector storage layer & cosine similarity search
    ├── routes/
    │   ├── ingestionRoutes.js       # Book ingestion REST endpoints
    │   └── chatRoutes.js            # Chat / RAG query REST endpoints
    ├── services/
    │   ├── embeddingService.js      # Google Gemini embedding service (text-embedding-004)
    │   └── geminiService.js         # Google Gemini LLM generation service with guardrails
    └── utils/
        ├── pdfParser.js             # PDF text extraction utility
        └── textChunker.js           # Text chunking and sliding window utility
```

---

## 🚀 Getting Started

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```

### 3. Running the Server
```bash
npm run dev
```

---

## 📡 API Endpoints

- **Upload Book (PDF)**: `POST http://localhost:5000/api/ingestion/upload-book`
- **List Books**: `GET http://localhost:5000/api/ingestion/books`
- **Ask Question**: `POST http://localhost:5000/api/chat/query`

## Operations notes (admin system)

- Requires Node 22.5+ (uses node:sqlite).
- Persist DATA_DIR (database, vault, uploads) on a durable volume; otherwise accounts and records vanish on redeploy.
- Set a real GEMINI_API_KEY; without it uploads that need OCR or embeddings fail with AI_NOT_CONFIGURED / AI_KEY_INVALID (shown in the UI, never as fake success).
- First start creates the admin account from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD / ADMIN_NAME.
- Supervisors are invited from the admin panel (one-time activation link, 72 h).
- Run npm test for acceptance tests; node scripts/check-i18n.js for the localization audit; node scripts/verify-deployment.js against deployed URLs.
- Existing records can be repaired from Admin > System > Reconciliation (analyze first, then apply).
