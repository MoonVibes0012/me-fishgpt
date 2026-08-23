require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());

// Multer (hanya terima .txt, max 1MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file .txt yang diperbolehkan'));
    }
  }
});

// Buat tabel jika belum ada
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      source VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('Database siap');
}

// ========== ROUTES ==========

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'me fishgpt backend online' });
});

// Upload file .txt
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Tidak ada file' });
    }

    const text = req.file.buffer.toString('utf-8').trim();
    if (!text) {
      return res.status(400).json({ error: 'File kosong' });
    }

    // Pecah menjadi potongan (per baris atau per paragraf)
    const chunks = text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length > 10); // buang baris terlalu pendek

    for (const chunk of chunks) {
      await pool.query(
        'INSERT INTO knowledge (content, source) VALUES ($1, $2)',
        [chunk, req.file.originalname]
      );
    }

    res.json({
      message: `Berhasil menyimpan ${chunks.length} potongan pengetahuan`,
      chunks: chunks.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan pengetahuan' });
  }
});

// Ambil 1 potongan acak dari pengetahuan
app.get('/knowledge/random', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT content FROM knowledge ORDER BY RANDOM() LIMIT 1'
    );

    if (result.rows.length === 0) {
      return res.json({ content: null });
    }

    res.json({ content: result.rows[0].content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil pengetahuan' });
  }
});

// Jumlah pengetahuan
app.get('/knowledge/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM knowledge');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghitung' });
  }
});

// Jalankan
initDB().then(() => {
  app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
  });
});
