require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// ===== DATABASE POOL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 8000
});

// Warm-up
pool.query('SELECT 1').catch(() => {});

// ===== MIDDLEWARE =====
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'] }));
app.use(express.json({ limit: '512kb' }));

// Simple response time log
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 300) console.log(`⚠️  ${req.method} ${req.url} - ${ms}ms`);
  });
  next();
});

// ===== MULTER =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'text/plain' || file.originalname.toLowerCase().endsWith('.txt');
    cb(ok ? null : new Error('Hanya file .txt yang diperbolehkan'), ok);
  }
});

// ===== INIT DB =====
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        source VARCHAR(255) DEFAULT 'unknown',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_id ON knowledge(id)`);
    console.log('✅ Database ready');
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
  }
}

// ===== ROUTES =====

// Health check + DB ping
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'online', db: true, t: Date.now() });
  } catch {
    res.status(500).json({ status: 'online', db: false, t: Date.now() });
  }
});

// Upload (batch)
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });

      const text = req.file.buffer.toString('utf-8').trim();
      if (!text) return res.status(400).json({ error: 'File kosong' });

      const chunks = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 8);

      if (chunks.length === 0) {
        return res.status(400).json({ error: 'Tidak ada konten valid' });
      }

      const source = req.file.originalname || 'unknown';
      const sources = chunks.map(() => source);

      await pool.query(
        `INSERT INTO knowledge (content, source)
         SELECT * FROM UNNEST($1::text[], $2::text[])`,
        [chunks, sources]
      );

      res.json({
        message: `Berhasil menyimpan ${chunks.length} potongan`,
        chunks: chunks.length
      });
    } catch (error) {
      console.error('Upload error:', error.message);
      res.status(500).json({ error: 'Gagal menyimpan' });
    }
  });
});

// Random knowledge (cepat)
app.get('/knowledge/random', async (req, res) => {
  try {
    // Coba teknik cepat dulu
    let result = await pool.query(`
      SELECT content FROM knowledge
      TABLESAMPLE SYSTEM (15)
      LIMIT 1
    `);

    // Fallback jika TABLESAMPLE tidak mengembalikan baris
    if (result.rows.length === 0) {
      const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM knowledge');
      const total = countRes.rows[0].total;

      if (total === 0) return res.json({ content: null });

      const offset = Math.floor(Math.random() * total);
      result = await pool.query(
        'SELECT content FROM knowledge OFFSET $1 LIMIT 1',
        [offset]
      );
    }

    res.json({ content: result.rows[0]?.content || null });
  } catch (err) {
    console.error('Random error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// Count
app.get('/knowledge/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM knowledge');
    res.json({ count: result.rows[0].total });
  } catch {
    res.status(500).json({ error: 'Gagal menghitung' });
  }
});

// Reset
app.delete('/knowledge/reset', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM knowledge');
    res.json({
      message: `Berhasil menghapus ${result.rowCount || 0} potongan`,
      deleted: result.rowCount || 0
    });
  } catch {
    res.status(500).json({ error: 'Gagal reset' });
  }
});

// Recent (debug)
app.get('/knowledge/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, left(content, 80) AS content, source, created_at
      FROM knowledge
      ORDER BY id DESC
      LIMIT 8
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Gagal' });
  }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ===== START + GRACEFUL SHUTDOWN =====
initDB().then(() => {
  const server = app.listen(port, () => {
    console.log(`🚀 Server ready on port ${port}`);
  });

  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
      pool.end();
      process.exit(0);
    });
  });
});
