require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ====== API KEYS ======
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || '').trim();

// ====== DAFTAR MODEL PER PROVIDER ======
const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest'
];

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it'
];

// ====== PROMPT BUILDER ======
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

FORMAT OUTPUT (HANYA JSON, tanpa markdown, tanpa penjelasan tambahan):
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

// ====== FETCH DENGAN TIMEOUT ======
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

// ====== PROVIDER 1: GEMINI ======
async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('NO_KEY');

  let lastError = '';

  for (const modelName of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini] ${modelName} (attempt ${attempt})`);

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
        }, 20000);

        const rawText = await response.text();
        let data;
        try { data = JSON.parse(rawText); }
        catch { lastError = 'NON_JSON'; break; }

        if (!response.ok) {
          const errMsg = data.error?.message || `HTTP ${response.status}`;
          console.error(`[Gemini] Error ${response.status}: ${errMsg}`);

          if (response.status === 503 || response.status === 429) {
            lastError = `Gemini sibuk (${response.status})`;
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          if (response.status === 404) { lastError = 'Model tidak ada'; break; }
          throw new Error(errMsg);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Respons kosong');
        console.log(`[Gemini] ✅ Sukses: ${modelName}`);
        return text;

      } catch (err) {
        lastError = err.message;
        console.error(`[Gemini] Exception: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  throw new Error(`Gemini gagal: ${lastError}`);
}

// ====== PROVIDER 2: GROQ ======
async function callGroq(prompt) {
  if (!GROQ_KEY) throw new Error('NO_KEY');

  let lastError = '';

  for (const modelName of GROQ_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Groq] ${modelName} (attempt ${attempt})`);

        const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_KEY}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: 'Kamu adalah AI pembuat soal yang hanya membalas dengan JSON valid, tanpa markdown, tanpa teks tambahan.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.4,
            response_format: { type: 'json_object' },
            max_tokens: 8000
          })
        }, 20000);

        const rawText = await response.text();
        let data;
        try { data = JSON.parse(rawText); }
        catch { lastError = 'NON_JSON'; break; }

        if (!response.ok) {
          const errMsg = data.error?.message || `HTTP ${response.status}`;
          console.error(`[Groq] Error ${response.status}: ${errMsg}`);

          if (response.status === 503 || response.status === 429) {
            lastError = `Groq sibuk (${response.status})`;
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          if (response.status === 404 || response.status === 400) {
            lastError = `Model ${modelName} tidak valid`;
            break;
          }
          throw new Error(errMsg);
        }

        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Respons kosong');
        console.log(`[Groq] ✅ Sukses: ${modelName}`);
        return text;

      } catch (err) {
        lastError = err.message;
        console.error(`[Groq] Exception: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  throw new Error(`Groq gagal: ${lastError}`);
}

// ====== ORKESTRATOR: Coba semua provider berurutan ======
async function callAIWithFallback(prompt) {
  const providers = [
    { name: 'Gemini', fn: callGemini, hasKey: !!GEMINI_KEY },
    { name: 'Groq', fn: callGroq, hasKey: !!GROQ_KEY }
  ];

  const errors = [];

  for (const provider of providers) {
    if (!provider.hasKey) {
      console.log(`[Fallback] Skip ${provider.name} (API key tidak ada)`);
      errors.push(`${provider.name}: tidak ada API key`);
      continue;
    }

    try {
      console.log(`[Fallback] === Mencoba provider: ${provider.name} ===`);
      const result = await provider.fn(prompt);
      console.log(`[Fallback] ✅ ${provider.name} berhasil!`);
      return { text: result, provider: provider.name };
    } catch (err) {
      console.warn(`[Fallback] ❌ ${provider.name} gagal: ${err.message}`);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  throw new Error(`Semua AI sibuk. ${errors.join(' | ')}`);
}

// ====== ENDPOINT GENERATE ======
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const { text, jumlahSoal = 10 } = req.body;

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Materi terlalu pendek atau kosong.' });
    }
    if (!GEMINI_KEY && !GROQ_KEY) {
      return res.status(500).json({ error: 'Tidak ada API key yang dikonfigurasi.' });
    }

    const materi = text.slice(0, 25000);
    const prompt = buildPrompt(materi, parseInt(jumlahSoal));

    const { text: raw, provider } = await callAIWithFallback(prompt);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Format JSON dari AI tidak valid.');
    }

    res.json({ success: true, data: parsed, provider });
  } catch (err) {
    console.error('Error generate:', err);
    res.status(500).json({ error: err.message || 'Gagal generate soal.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    providers: {
      gemini: !!GEMINI_KEY,
      groq: !!GROQ_KEY
    }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Server jalan di http://localhost:${PORT}`));
}

module.exports = app;