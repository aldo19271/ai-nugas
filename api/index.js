// Nugas.AI - v9 (auto-sync provider)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || '').trim();

const GEMINI_MODELS = ['gemini-3.8-flash'];
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const BATCH_SIZE = 15;

function buildPrompt(materi, jumlahSoal) {
  return 'Kamu adalah AI pembuat soal ujian yang AKURAT dan TELITI.\n\n' +
    'TUGAS: Analisis materi berikut, lalu hasilkan soal kuis pilihan ganda.\n\n' +
    'ATURAN ANALISIS:\n' +
    '1. JIKA file berisi SOAL + PILIHAN GANDA + JAWABAN:\n' +
    '   -> Ekstrak PERSIS seperti di file\n' +
    '   -> Jumlah opsi jawaban IKUTI file\n' +
    '   -> WAJIB: Sertakan field "penjelasan" (1-2 kalimat)\n\n' +
    '2. JIKA file berisi SOAL saja:\n' +
    '   -> Buatkan pilihan ganda A-E sendiri\n' +
    '   -> WAJIB: Sertakan field "penjelasan"\n\n' +
    '3. JIKA file berisi MATERI saja:\n' +
    '   -> Buatkan TEPAT ' + jumlahSoal + ' SOAL. Tidak kurang, tidak lebih.\n' +
    '   -> Setiap soal WAJIB punya field "penjelasan" (1-2 kalimat)\n\n' +
    'FORMAT OUTPUT (HANYA JSON, tanpa markdown):\n' +
    '{\n' +
    '  "mode": "ekstrak" | "buat_soal" | "buat_dari_materi",\n' +
    '  "jumlah_opsi": 4 atau 5,\n' +
    '  "judul": "Judul singkat kuis",\n' +
    '  "soal": [\n' +
    '    {\n' +
    '      "pertanyaan": "Teks pertanyaan",\n' +
    '      "pilihan": { "A": "...", "B": "...", "C": "...", "D": "...", "E": "..." },\n' +
    '      "jawaban_benar": "B",\n' +
    '      "penjelasan": "Penjelasan singkat"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'Jika opsi hanya 4, hilangkan key "E".\n\n' +
    'MATERI:\n"""\n' + materi + '\n"""\n';
}

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

// ====== GEMINI ======
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
      }, 15000);

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); } catch (e) { lastError = modelName + ': non-JSON'; continue; }

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

// ====== GROQ ======
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
            { role: 'system', content: 'Kamu adalah AI pembuat soal yang hanya membalas JSON valid. WAJIB patuhi jumlah soal PERSIS.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
          max_tokens: 8000
        })
      }, 20000);

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); } catch (e) { lastError = modelName + ': non-JSON'; continue; }

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

// ==================================================
// ====== DAFTAR PROVIDER (AUTO-SYNC KE FRONTEND) ======
// ==================================================
// Untuk tambah provider baru, cukup tambah 1 baris di array ini.
// Format: { id: 'NamaUnik', label: 'Nama Tampil', fn: fungsiCall, hasKey: boolean }
function getAvailableProviders() {
  const list = [
    { id: 'Gemini', label: 'Gemini', fn: callGemini, hasKey: !!GEMINI_KEY },
    { id: 'Groq', label: 'Groq', fn: callGroq, hasKey: !!GROQ_KEY },
    // Contoh tambah provider baru (kalau sudah ada fungsi callX):
    // { id: 'Cerebras', label: 'Cerebras', fn: callCerebras, hasKey: !!CEREBRAS_KEY },
  ];
  return list.filter(p => p.hasKey);
}

// Endpoint untuk frontend: dapatkan daftar provider aktif
app.get('/api/providers', (req, res) => {
  const providers = getAvailableProviders().map(p => ({ id: p.id, label: p.label }));
  res.json({ providers });
});

// Panggil provider yang dipilih user
async function callAIWithProvider(prompt, providerId) {
  const providers = getAvailableProviders();

  if (providers.length === 0) {
    throw new Error('Tidak ada provider AI yang tersedia.');
  }

  // Cari provider sesuai pilihan user
  let provider = providers.find(p => p.id === providerId);

  // Kalau provider tidak ditemukan, pakai provider pertama sebagai fallback
  if (!provider) {
    console.warn('[Provider] "' + providerId + '" tidak ditemukan, pakai default: ' + providers[0].id);
    provider = providers[0];
  }

  const result = await provider.fn(prompt);
  return { text: result, provider: provider.id };
}

// ====== PARSE JSON ======
function parseAIResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Format JSON dari AI tidak valid.');
  }
}

// ====== GENERATE DENGAN BATCHING ======
async function generateWithBatching(materi, jumlahSoalDiminta, providerId) {
  if (jumlahSoalDiminta <= BATCH_SIZE) {
    const prompt = buildPrompt(materi, jumlahSoalDiminta);
    const result = await callAIWithProvider(prompt, providerId);
    const parsed = parseAIResponse(result.text);

    if (parsed.soal && Array.isArray(parsed.soal)) {
      if (parsed.mode === 'buat_dari_materi' && parsed.soal.length > jumlahSoalDiminta) {
        parsed.soal = parsed.soal.slice(0, jumlahSoalDiminta);
      }
      parsed.soal = parsed.soal.map(s => {
        if (!s.penjelasan || s.penjelasan.trim() === '') {
          s.penjelasan = 'Jawaban yang benar adalah ' + s.jawaban_benar + '.';
        }
        return s;
      });
    }
    return { data: parsed, provider: result.provider };
  }

  console.log('[Batch] Memecah ' + jumlahSoalDiminta + ' soal jadi batch @' + BATCH_SIZE);

  const batches = [];
  let sisa = jumlahSoalDiminta;
  while (sisa > 0) {
    const n = Math.min(sisa, BATCH_SIZE);
    batches.push(n);
    sisa -= n;
  }

  const semuaSoal = [];
  let providerTerakhir = '';
  let modeTerakhir = '';
  let judulTerakhir = '';
  let jumlahOpsiTerakhir = 5;

  for (let i = 0; i < batches.length; i++) {
    const n = batches[i];
    console.log('[Batch] ' + (i + 1) + '/' + batches.length + ' → ' + n + ' soal');

    const prompt = buildPrompt(materi, n);
    const result = await callAIWithProvider(prompt, providerId);
    const parsed = parseAIResponse(result.text);

    if (parsed.soal && Array.isArray(parsed.soal)) {
      semuaSoal.push(...parsed.soal.slice(0, n));
    }

    providerTerakhir = result.provider;
    modeTerakhir = parsed.mode || 'buat_dari_materi';
    judulTerakhir = parsed.judul || 'Kuis Latihan';
    jumlahOpsiTerakhir = parsed.jumlah_opsi || 5;
  }

  if (semuaSoal.length > jumlahSoalDiminta) {
    semuaSoal.splice(jumlahSoalDiminta);
  }

  semuaSoal.forEach(s => {
    if (!s.penjelasan || s.penjelasan.trim() === '') {
      s.penjelasan = 'Jawaban yang benar adalah ' + s.jawaban_benar + '.';
    }
  });

  return {
    data: {
      mode: modeTerakhir,
      jumlah_opsi: jumlahOpsiTerakhir,
      judul: judulTerakhir,
      soal: semuaSoal
    },
    provider: providerTerakhir
  };
}

// ====== ENDPOINT GENERATE ======
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const text = req.body.text;
    const jumlahSoalDiminta = parseInt(req.body.jumlahSoal) || 10;
    const provider = req.body.provider || 'Gemini';

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Materi terlalu pendek.' });
    }
    if (getAvailableProviders().length === 0) {
      return res.status(500).json({ error: 'Tidak ada API key yang dikonfigurasi.' });
    }

    const materi = text.slice(0, 25000);
    const result = await generateWithBatching(materi, jumlahSoalDiminta, provider);

    res.json({ success: true, data: result.data, provider: result.provider });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Gagal generate soal.' });
  }
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
  const providers = getAvailableProviders().map(p => p.id);
  res.json({
    status: 'ok',
    version: 'v9',
    providers: providers
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('Server di http://localhost:' + PORT));
}

module.exports = app;