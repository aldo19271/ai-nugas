// Nugas.AI - v5
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

// ====== DAFTAR MODEL (VERSI TERBARU) ======
const GEMINI_MODELS = ['gemini-3.8-flash'];
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// ====== PROMPT BUILDER ======
function buildPrompt(materi, jumlahSoal) {
  return 'Kamu adalah AI pembuat soal ujian yang AKURAT dan TELITI.\n\n' +
    'TUGAS: Analisis materi berikut, lalu hasilkan soal kuis pilihan ganda.\n\n' +
    'ATURAN ANALISIS (WAJIB DIIKUTI):\n' +
    '1. JIKA file berisi SOAL + PILIHAN GANDA + JAWABAN:\n' +
    '   -> Ekstrak PERSIS seperti di file (jangan ubah/tambah)\n' +
    '   -> Jumlah opsi jawaban IKUTI file (kalau hanya A-D, ya A-D saja)\n' +
    '   -> Jawaban benar ikuti file\n\n' +
    '2. JIKA file berisi SOAL saja (tanpa pilihan ganda):\n' +
    '   -> Buatkan pilihan ganda A-E sendiri\n' +
    '   -> Tentukan jawaban yang paling benar\n\n' +
    '3. JIKA file berisi MATERI saja (tanpa soal):\n' +
    '   -> Buatkan ' + jumlahSoal + ' soal pilihan ganda A-E\n' +
    '   -> Soal harus menguji pemahaman materi\n' +
    '   -> Sertakan penjelasan singkat\n\n' +
    'FORMAT OUTPUT (HANYA JSON, tanpa markdown, tanpa penjelasan tambahan):\n' +
    '{\n' +
    '  "mode": "ekstrak" | "buat_soal" | "buat_dari_materi",\n' +
    '  "jumlah_opsi": 4 atau 5,\n' +
    '  "judul": "Judul singkat kuis",\n' +
    '  "soal": [\n' +
    '    {\n' +
    '      "pertanyaan": "Teks pertanyaan",\n' +
    '      "pilihan": {\n' +
    '        "A": "teks A",\n' +
    '        "B": "teks B",\n' +
    '        "C": "teks C",\n' +
    '        "D": "teks D",\n' +
    '        "E": "teks E"\n' +
    '      },\n' +
    '      "jawaban_benar": "B",\n' +
    '      "penjelasan": "Penjelasan singkat (1-2 kalimat)"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'Jika opsi hanya 4, hilangkan key "E".\n\n' +
    'MATERI:\n"""\n' + materi + '\n"""\n';
}

// ====== FETCH DENGAN TIMEOUT ======
async function fetchWithTimeout(url, options, timeoutMs) {
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
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + GEMINI_KEY;
    try {
      console.log('[Gemini] ' + modelName);
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
      }, 12000);

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch (e) { lastError = modelName + ': non-JSON'; continue; }

      if (!response.ok) {
        const errMsg = (data.error && data.error.message) || ('HTTP ' + response.status);
        lastError = modelName + ': ' + errMsg;
        console.error('[Gemini] ' + response.status + ': ' + errMsg);
        continue;
      }

      const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) { lastError = modelName + ': kosong'; continue; }

      console.log('[Gemini] OK: ' + modelName);
      return text;

    } catch (err) {
      lastError = err.name === 'AbortError' ? (modelName + ': timeout') : (modelName + ': ' + err.message);
      console.error('[Gemini] ' + lastError);
    }
  }

  throw new Error('Gemini gagal: ' + lastError);
}

// ====== PROVIDER 2: GROQ ======
async function callGroq(prompt) {
  if (!GROQ_KEY) throw new Error('NO_KEY');
  let lastError = '';

  for (const modelName of GROQ_MODELS) {
    try {
      console.log('[Groq] ' + modelName);
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + GROQ_KEY
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'Kamu adalah AI pembuat soal yang hanya membalas JSON valid, tanpa markdown.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
          max_tokens: 8000
        })
      }, 15000);

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch (e) { lastError = modelName + ': non-JSON'; continue; }

      if (!response.ok) {
        const errMsg = (data.error && data.error.message) || ('HTTP ' + response.status);
        lastError = modelName + ': ' + errMsg;
        console.error('[Groq] ' + response.status + ': ' + errMsg);
        continue;
      }

      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) { lastError = modelName + ': kosong'; continue; }

      console.log('[Groq] OK: ' + modelName);
      return text;

    } catch (err) {
      lastError = err.name === 'AbortError' ? (modelName + ': timeout') : (modelName + ': ' + err.message);
      console.error('[Groq] ' + lastError);
    }
  }

  throw new Error('Groq gagal: ' + lastError);
}

// ====== ORKESTRATOR ======
async function callAIWithFallback(prompt) {
  const providers = [
    { name: 'Gemini', fn: callGemini, hasKey: !!GEMINI_KEY },
    { name: 'Groq', fn: callGroq, hasKey: !!GROQ_KEY }
  ];

  const errors = [];

  for (const provider of providers) {
    if (!provider.hasKey) {
      console.log('[Fallback] Skip ' + provider.name);
      errors.push(provider.name + ': no key');
      continue;
    }
    try {
      console.log('[Fallback] === Coba ' + provider.name + ' ===');
      const result = await provider.fn(prompt);
      console.log('[Fallback] ' + provider.name + ' OK');
      return { text: result, provider: provider.name };
    } catch (err) {
      console.warn('[Fallback] ' + provider.name + ': ' + err.message);
      errors.push(provider.name + ': ' + err.message);
    }
  }

  throw new Error('Semua AI gagal coba lagi nanti.');
}

// ====== ENDPOINT ======
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const text = req.body.text;
    const jumlahSoal = req.body.jumlahSoal || 10;

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Materi terlalu pendek.' });
    }
    if (!GEMINI_KEY && !GROQ_KEY) {
      return res.status(500).json({ error: 'Tidak ada API key.' });
    }

    const materi = text.slice(0, 25000);
    const prompt = buildPrompt(materi, parseInt(jumlahSoal));

    const result = await callAIWithFallback(prompt);
    const raw = result.text;
    const provider = result.provider;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Format JSON dari AI tidak valid.');
    }

    res.json({ success: true, data: parsed, provider: provider });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Gagal generate soal.' });
  }
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v5',
    providers: {
      gemini: !!GEMINI_KEY,
      groq: !!GROQ_KEY
    }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('Server di http://localhost:' + PORT));
}

module.exports = app;