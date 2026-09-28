require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ====== GEMINI SETUP ======
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    temperature: 0.4,
    responseMimeType: 'application/json'
  }
});

// ====== PROMPT ADAPTIF ======
const buildPrompt = (materi, jumlahSoal) => `
Kamu adalah AI pembuat soal ujian yang AKURAT dan TELITI.

TUGAS: Analisis materi berikut, lalu hasilkan soal kuis pilihan ganda.

ATURAN ANALISIS (WAJIB DIIKUTI):
1. JIKA file berisi SOAL + PILIHAN GANDA + JAWABAN:
   → Ekstrak PERSIS seperti di file (jangan ubah/ tambah)
   → Jumlah opsi jawaban IKUTI file (kalau hanya A-D, ya A-D saja)
   → Jawaban benar ikuti file

2. JIKA file berisi SOAL saja (tanpa pilihan ganda):
   → Buatkan pilihan ganda A-E sendiri
   → Tentukan jawaban yang paling benar

3. JIKA file berisi MATERI saja (tanpa soal):
   → Buatkan ${jumlahSoal} soal pilihan ganda A-E
   → Soal harus menguji pemahaman materi
   → Sertakan penjelasan singkat

FORMAT OUTPUT (JSON ketat, tanpa markdown):
{
  "mode": "ekstrak" | "buat_soal" | "buat_dari_materi",
  "jumlah_opsi": 4 atau 5,
  "judul": "Judul singkat kuis",
  "soal": [
    {
      "pertanyaan": "Teks pertanyaan",
      "pilihan": {
        "A": "teks A",
        "B": "teks B",
        "C": "teks C",
        "D": "teks D",
        "E": "teks E"
      },
      "jawaban_benar": "B",
      "penjelasan": "Penjelasan singkat (1-2 kalimat)"
    }
  ]
}

Jika opsi hanya 4, hilangkan key "E".

MATERI:
"""
${materi}
"""
`;

// ====== ENDPOINT: GENERATE SOAL ======
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const { text, jumlahSoal = 10 } = req.body;

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Materi terlalu pendek atau kosong.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY belum diset.' });
    }

    // Batasi panjang teks biar tidak over token
    const materi = text.slice(0, 30000);
    const prompt = buildPrompt(materi, parseInt(jumlahSoal));

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // fallback: cari JSON di dalam string
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Format JSON dari AI tidak valid.');
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('Error generate:', err);
    res.status(500).json({ error: err.message || 'Gagal generate soal.' });
  }
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', gemini: !!process.env.GEMINI_API_KEY });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Server jalan di http://localhost:${PORT}`));
}

module.exports = app;