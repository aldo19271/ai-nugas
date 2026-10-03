// Nugas.AI - v12 (Groq sebagai default)
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

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest'
];
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

const BATCH_SIZE = 10;

function buildPrompt(materi, jumlahSoal) {
  return 'Kamu adalah AI pembuat soal ujian yang AKURAT dan TELITI.\n\n' +
    'TUGAS: Analisis materi berikut, lalu hasilkan soal kuis pilihan ganda.\n\n' +
    'ATURAN ANALISIS:\n' +
    '1. JIKA file berisi SOAL + PILIHAN GANDA + JAWABAN:\n' +
    '   -> Ekstrak PERSIS seperti di file\n' +
    '   -> Jumlah opsi jawaban IKUTI file\n' +
    '   -> WAJIB: Sertakan field "penjelasan" (1 kalimat singkat)\n\n' +
    '2. JIKA file berisi SOAL saja:\n' +
    '   -> Buatkan pilihan ganda A-E sendiri\n' +
    '   -> WAJIB: Sertakan field "penjelasan" (1 kalimat)\n\n' +
    '3. JIKA file berisi MATERI saja:\n' +
    '   -> Buatkan TEPAT ' + jumlahSoal + ' SOAL. Tidak kurang, tidak lebih.\n' +
    '   -> Setiap soal WAJIB punya field "penjelasan" (1 kalimat singkat)\n\n' +
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
    '      "penjelasan": "Penjelasan singkat 1 kalimat"\n' +
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

// ====== GEMINI (untuk model spesifik) ======
async function callGeminiForModel(prompt, specificModel) {
  if (!GEMINI_KEY) throw new Error('NO_KEY');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + specificModel + ':generateContent?key=' + GEMINI_KEY;
  console.log('[Gemini] ' + specificModel);
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
  }, 55000);

  const rawText = await response.text();
  let data;
  try { data = JSON.parse(rawText); } catch (e) { throw new Error(specificModel + ': non-JSON'); }

  if (!response.ok) {
    const errMsg = (data.error && data.error.message) || ('HTTP ' + response.status);
    console.error('[Gemini] ' + response.status + ': ' + errMsg);
    throw new Error(specificModel + ': ' + errMsg);
  }

  const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error(specificModel + ': kosong');

  console.log('[Gemini] OK: ' + specificModel);
  return text;
}

// ====== GROQ (untuk model spesifik) ======
async function callGroqForModel(prompt, specificModel) {
  if (!GROQ_KEY) throw new Error('NO_KEY');
  console.log('[Groq] ' + specificModel);
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY
    },
    body: JSON.stringify({
      model: specificModel,
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
  try { data = JSON.parse(rawText); } catch (e) { throw new Error(specificModel + ': non-JSON'); }

  if (!response.ok) {
    const errMsg = (data.error && data.error.message) || ('HTTP ' + response.status);
    console.error('[Groq] ' + response.status + ': ' + errMsg);
    throw new Error(specificModel + ': ' + errMsg);
  }

  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error(specificModel + ': kosong');

  console.log('[Groq] OK: ' + specificModel);
  return text;
}

// ==================================================
// ====== DAFTAR MODEL (GROQ DULUAN) ======
// ==================================================
function getAvailableProviders() {
  const list = [];

  // Groq duluan biar muncul & terpilih pertama
  if (GROQ_KEY) {
    GROQ_MODELS.forEach(m => {
      list.push({
        id: m,
        label: m,
        provider: 'Groq',
        fn: function(prompt) { return callGroqForModel(prompt, m); },
        hasKey: true
      });
    });
  }

  if (GEMINI_KEY) {
    GEMINI_MODELS.forEach(m => {
      list.push({
        id: m,
        label: m,
        provider: 'Gemini',
        fn: function(prompt) { return callGeminiForModel(prompt, m); },
        hasKey: true
      });
    });
  }

  return list;
}

app.get('/api/providers', (req, res) => {
  const providers = getAvailableProviders().map(p => ({ id: p.id, label: p.label, provider: p.provider }));
  res.json({ providers });
});

async function callAIWithProvider(prompt, modelId) {
  const providers = getAvailableProviders();
  if (providers.length === 0) throw new Error('Tidak ada model AI yang tersedia.');

  let provider = providers.find(p => p.id === modelId);
  if (!provider) {
    console.warn('[Model] "' + modelId + '" tidak ditemukan, pakai default: ' + providers[0].id);
    provider = providers[0];
  }

  const result = await provider.fn(prompt);
  return { text: result, provider: provider.id, providerName: provider.provider };
}

// ====== JSON REPAIR ======
function parseAIResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[JSON] Parse gagal, mencoba repair...');
    let cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('Format JSON tidak valid.');
    cleaned = cleaned.substring(start);

    try { return JSON.parse(cleaned); } catch (e2) {}

    const lastValidBrace = cleaned.lastIndexOf('}');
    if (lastValidBrace > 0) {
      let repaired = cleaned.substring(0, lastValidBrace + 1);
      for (let i = 0; i < 5; i++) {
        try {
          return JSON.parse(repaired + ']}');
        } catch (err) {
          repaired = repaired.substring(0, repaired.lastIndexOf('}'));
        }
      }
    }
    throw new Error('Format JSON dari AI terpotong dan tidak bisa diperbaiki.');
  }
}

// ====== GENERATE DENGAN BATCHING ======
async function generateWithBatching(materi, jumlahSoalDiminta, modelId) {
  if (jumlahSoalDiminta <= BATCH_SIZE) {
    const prompt = buildPrompt(materi, jumlahSoalDiminta);
    const result = await callAIWithProvider(prompt, modelId);
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
    return { data: parsed, provider: result.provider, providerName: result.providerName };
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
  let providerNameTerakhir = '';
  let modeTerakhir = '';
  let judulTerakhir = '';
  let jumlahOpsiTerakhir = 5;

  for (let i = 0; i < batches.length; i++) {
    const n = batches[i];
    console.log('[Batch] ' + (i + 1) + '/' + batches.length + ' → ' + n + ' soal');
    const prompt = buildPrompt(materi, n);
    const result = await callAIWithProvider(prompt, modelId);
    const parsed = parseAIResponse(result.text);

    if (parsed.soal && Array.isArray(parsed.soal)) {
      semuaSoal.push(...parsed.soal.slice(0, n));
    }
    providerTerakhir = result.provider;
    providerNameTerakhir = result.providerName;
    modeTerakhir = parsed.mode || 'buat_dari_materi';
    judulTerakhir = parsed.judul || 'Kuis Latihan';
    jumlahOpsiTerakhir = parsed.jumlah_opsi || 5;
  }

  if (semuaSoal.length > jumlahSoalDiminta) semuaSoal.splice(jumlahSoalDiminta);
  semuaSoal.forEach(s => {
    if (!s.penjelasan || s.penjelasan.trim() === '') {
      s.penjelasan = 'Jawaban yang benar adalah ' + s.jawaban_benar + '.';
    }
  });

  return {
    data: { mode: modeTerakhir, jumlah_opsi: jumlahOpsiTerakhir, judul: judulTerakhir, soal: semuaSoal },
    provider: providerTerakhir,
    providerName: providerNameTerakhir
  };
}

// ====== ENDPOINT GENERATE ======
app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const text = req.body.text;
    const jumlahSoalDiminta = parseInt(req.body.jumlahSoal) || 10;
    // Default: Groq (kalau frontend tidak kirim provider)
    const modelId = req.body.provider || 'openai/gpt-oss-120b';

    if (!text || text.trim().length < 30) return res.status(400).json({ error: 'Materi terlalu pendek.' });
    if (getAvailableProviders().length === 0) return res.status(500).json({ error: 'Tidak ada API key.' });

    const materi = text.slice(0, 25000);
    const result = await generateWithBatching(materi, jumlahSoalDiminta, modelId);

    res.json({ success: true, data: result.data, provider: result.provider, providerName: result.providerName });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Gagal generate soal.' });
  }
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
  const models = getAvailableProviders().map(p => p.id);
  res.json({ status: 'ok', version: 'v12', models: models });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('Server di http://localhost:' + PORT));
}

module.exports = app;