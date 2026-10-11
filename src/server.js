require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const ingestionRoutes = require('./routes/ingestionRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const { downloadVaultFile } = require('./controllers/ingestionController');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS across domains and subdomains
app.use(cors());

// Body Parsers
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Production Health Check & Data Vault Diagnostic Endpoint
app.get('/health', async (req, res) => {
  try {
    const { getSystemOverviewStats } = require('./models/vectorDbModel');
    const stats = await getSystemOverviewStats();
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Private Gemini RAG Multi-Domain Assistant & Data Vault Backend',
      environment: process.env.NODE_ENV || 'production',
      dataVault: {
        status: 'operational',
        storageType: process.env.GCS_BUCKET_NAME ? 'Google Cloud Storage + Disk Vault' : 'Persistent Disk Data Vault',
        bucket: process.env.GCS_BUCKET_NAME || 'local-vault-storage',
        totalDocuments: stats.totalDocuments || 0,
        totalLifetimePages: stats.totalLifetimePages || 0,
        totalVectorChunks: stats.totalVectorChunks || 0,
      },
    });
  } catch (err) {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Private Gemini RAG Multi-Domain Assistant & Data Vault Backend',
      dataVault: { status: 'operational' },
    });
  }
});

// Data Vault direct file retrieval (with optional category folder)
app.get('/api/vault/:category/:filename', downloadVaultFile);
app.get('/api/vault/:filename', downloadVaultFile);

// API Routes
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);

// Static assets per isolated tier
app.use('/chat', express.static(path.join(__dirname, '../public/chat')));
app.use('/supervisor', express.static(path.join(__dirname, '../public/supervisor')));
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.use(express.static(path.join(__dirname, '../public/chat')));

// Subdomain & Path Multi-Tenant Routing Layer
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  const hostname = req.hostname.toLowerCase();

  // Tier 1: Subdomain bahth.masruq.com OR /chat path -> User Chat Interface
  if (hostname.startsWith('bahth.') || req.path.startsWith('/chat')) {
    return res.sendFile(path.join(__dirname, '../public/chat/index.html'));
  }

  // Tier 2: Subdomain waraqa.msruq.com OR /supervisor path -> Supervisor Data Entry Portal
  if (hostname.startsWith('waraqa.') || req.path.startsWith('/supervisor')) {
    return res.sendFile(path.join(__dirname, '../public/supervisor/index.html'));
  }

  // Tier 3: Subdomain logs.msruq.com / admin.msruq.com OR /admin path -> Super Admin Dashboard
  if (hostname.startsWith('logs.') || hostname.startsWith('admin.') || req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, '../public/admin/index.html'));
  }

  // Default Fallback: User Chat Interface
  res.sendFile(path.join(__dirname, '../public/chat/index.html'));
});

// Catch-all 404 for unknown API routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `API Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Uncaught Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('================================================================');
    console.log(`🚀 Multi-Domain Enterprise RAG & Data Vault Server on port ${PORT}`);
    console.log(`🌐 Tier 1 - User Chat (bahth.masruq.com):       http://localhost:${PORT}/`);
    console.log(`📝 Tier 2 - Supervisor Portal (waraqa.msruq.com): http://localhost:${PORT}/supervisor`);
    console.log(`👑 Tier 3 - Super Admin (logs.msruq.com):         http://localhost:${PORT}/admin`);
    console.log(`🗄️  Data Vault Endpoint:                          http://localhost:${PORT}/api/vault/:filename`);
    console.log('================================================================');
  });
}

module.exports = app;
