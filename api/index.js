require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();

// Daftar model fallback — urutkan dari yang paling stabil
const MODEL_FALLBACKS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite'
];

const buildPrompt = (materi, jumlahSoal) => `
Kamu adalah AI pembuat soal ujian yang AKURAT dan TELITI.

TUGAS: Analisis materi berikut, lalu hasilkan soal kuis pilihan ganda.

ATURAN ANALISIS (WAJIB DIIKUTI):
1. JIKA file berisi SOAL + PILIHAN GANDA + JAWABAN:
   → Ekstrak PERSIS seperti di file (jangan ubah/tambah)
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

// Fetch dengan timeout panjang (biar Gemini sempat balas)
async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Panggil Gemini dengan retry SABAR (delay 3 detik, 3 attempt per model)
async function callGemini(prompt) {
  let lastError = '';

  for (const modelName of MODEL_FALLBACKS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[Gemini] Coba: ${modelName} (attempt ${attempt}/3)`);

        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json',
              maxOutputTokens: 8192
            }
          })
        }, 25000);

        const rawText = await response.text();

        // Tangani response non-JSON
        let data;
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          lastError = `Server balas format tidak dikenal.`;
          console.error(`[Gemini] Non-JSON: ${rawText.slice(0, 200)}`);
          break;
        }

        if (!response.ok) {
          const errMsg = data.error?.message || `HTTP ${response.status}`;
          console.error(`[Gemini] Error ${response.status}: ${errMsg}`);

          // 503 / 429 → server sibuk, tunggu 3 detik, retry
          if (response.status === 503 || response.status === 429) {
            lastError = `Server sibuk (${response.status}). Mencoba lagi...`;
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
            continue;
          }

          // 404 → model tidak ada, coba model berikutnya
          if (response.status === 404) {
            lastError = `Model ${modelName} tidak tersedia.`;
            break;
          }

          throw new Error(errMsg);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Respons AI kosong.');

        console.log(`[Gemini] ✅ Sukses: ${modelName}`);
        return text;

      } catch (err) {
        lastError = err.message;
        console.error(`[Gemini] Exception: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  throw new Error(lastError || 'Semua model sibuk. Tunggu 1-2 menit lalu coba lagi.');
}

// Endpoint generate
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const { text, jumlahSoal = 10 } = req.body;

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Materi terlalu pendek atau kosong.' });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY belum diset.' });
    }

    const materi = text.slice(0, 25000);
    const prompt = buildPrompt(materi, parseInt(jumlahSoal));

    const raw = await callGemini(prompt);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', gemini: !!API_KEY });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Server jalan di http://localhost:${PORT}`));
}

module.exports = app;