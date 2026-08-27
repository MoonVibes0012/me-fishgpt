require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// ===== DATABASE =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10, // batasi koneksi
  idleTimeoutMillis: 30000
});

// Test koneksi saat start
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Database terhubung'))
  .catch(err => console.error('❌ Database error:', err.message));

// ===== MIDDLEWARE =====
app.use(cors({
  origin: '*', // bisa dikunci ke domain GitHub Pages kamu nanti
  methods: ['GET', 'POST', 'DELETE']
}));
app.use(express.json({ limit: '1mb' }));

// ===== MULTER (Upload) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const isTxt = file.mimetype === 'text/plain' || 
                  file.originalname.toLowerCase().endsWith('.txt');
    
    if (isTxt) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file .txt yang diperbolehkan'), false);
    }
  }
});

// ===== INIT TABLE =====
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
    
    // Index untuk mempercepat ORDER BY RANDOM() pada data kecil-menengah
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_id ON knowledge(id)
    `);
    
    console.log('✅ Tabel knowledge siap');
  } catch (err) {
    console.error('❌ Gagal init database:', err.message);
  }
}

// ===== ROUTES =====

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'me fishgpt backend online',
    time: new Date().toISOString()
  });
});

// Upload pengetahuan (.txt)
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Gagal upload file' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Tidak ada file yang dikirim' });
      }

      const text = req.file.buffer.toString('utf-8').trim();
      
      if (!text) {
        return res.status(400).json({ error: 'File kosong' });
      }

      // Pecah berdasarkan baris, buang yang terlalu pendek
      const chunks = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 8); // minimal 8 karakter

      if (chunks.length === 0) {
        return res.status(400).json({ error: 'Tidak ada konten yang valid (terlalu pendek)' });
      }

      // Insert batch
      let inserted = 0;
      for (const chunk of chunks) {
        await pool.query(
          'INSERT INTO knowledge (content, source) VALUES ($1, $2)',
          [chunk, req.file.originalname || 'unknown']
        );
        inserted++;
      }

      console.log(`📥 Berhasil insert ${inserted} potongan dari ${req.file.originalname}`);

      res.json({
        message: `Berhasil menyimpan ${inserted} potongan pengetahuan`,
        chunks: inserted
      });

    } catch (error) {
      console.error('Upload error:', error.message);
      res.status(500).json({ error: 'Gagal menyimpan ke database' });
    }
  });
});

// Ambil 1 pengetahuan acak
app.get('/knowledge/random', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT content 
      FROM knowledge 
      ORDER BY RANDOM() 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({ content: null });
    }

    res.json({ content: result.rows[0].content });
  } catch (err) {
    console.error('Random error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil pengetahuan' });
  }
});

// Jumlah pengetahuan
app.get('/knowledge/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM knowledge');
    res.json({ count: result.rows[0].total });
  } catch (err) {
    console.error('Count error:', err.message);
    res.status(500).json({ error: 'Gagal menghitung pengetahuan' });
  }
});

// Reset semua pengetahuan
app.delete('/knowledge/reset', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM knowledge RETURNING id');
    const deleted = result.rowCount || 0;

    console.log(`🗑️  Berhasil hapus ${deleted} potongan pengetahuan`);

    res.json({
      message: `Berhasil menghapus ${deleted} potongan pengetahuan`,
      deleted
    });
  } catch (err) {
    console.error('Reset error:', err.message);
    res.status(500).json({ error: 'Gagal mereset pengetahuan' });
  }
});

// (Opsional) Lihat beberapa pengetahuan terakhir - untuk debug
app.get('/knowledge/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, content, source, created_at 
      FROM knowledge 
      ORDER BY id DESC 
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Terjadi kesalahan internal' });
});

// ===== START =====
initDB().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server berjalan di port ${port}`);
  });
});
