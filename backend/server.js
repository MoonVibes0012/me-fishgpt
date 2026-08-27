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

// Multer - hanya terima .txt, maksimal 1MB
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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        source VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database siap');
  } catch (err) {
    console.error('Gagal init database:', err);
  }
}

// ================== ROUTES ==================

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

    // Pecah menjadi potongan (per baris)
    const chunks = text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length > 5);

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Tidak ada konten yang valid' });
    }

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

// Ambil 1 potongan acak
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
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghitung' });
  }
});

// ===== RESET SEMUA PENGETAHUAN =====
app.delete('/knowledge/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM knowledge');
    res.json({ message: 'Semua pengetahuan berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mereset pengetahuan' });
  }
});

// Jalankan server
initDB().then(() => {
  app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
  });
});
