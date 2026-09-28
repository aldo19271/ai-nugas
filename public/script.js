// ====== STATE ======
let state = {
  materiText: '',
  fileName: '',
  kuisData: null,
  currentIndex: 0,
  jawabanUser: [],
  jumlahOpsi: 4
};

// ====== ELEMENTS ======
const $ = (id) => document.getElementById(id);
const uploadZone = $('uploadZone');
const fileInput = $('fileInput');
const btnGenerate = $('btnGenerate');
const terminal = $('terminal');
const statusText = $('statusText');
const statusSkor = $('statusSkor');
const viewKuis = $('viewKuis');
const viewMateri = $('viewMateri');
const materiText = $('materiText');
const fileItem = $('fileItem');
const fileName = $('fileName');

// ====== UTIL: LOG KE TERMINAL ======
function log(msg, type = '') {
  const div = document.createElement('div');
  div.className = 'term-line' + (type ? ' ' + type : '');
  div.textContent = '> ' + msg;
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}

function setStatus(text, icon = '🔵') {
  $('statusIcon').textContent = icon;
  statusText.textContent = text;
}

// ====== TAB SWITCHING ======
$('tabSoal').onclick = () => switchTab('kuis');
$('tabMateri').onclick = () => switchTab('materi');
function switchTab(tab) {
  if (tab === 'kuis') {
    $('tabSoal').classList.add('active');
    $('tabMateri').classList.remove('active');
    viewKuis.hidden = false;
    viewMateri.hidden = true;
    $('breadcrumb').textContent = 'belajar-ai › kuis.json';
  } else {
    $('tabMateri').classList.add('active');
    $('tabSoal').classList.remove('active');
    viewKuis.hidden = true;
    viewMateri.hidden = false;
    $('breadcrumb').textContent = 'belajar-ai › materi.txt';
  }
}

// ====== UPLOAD ======
uploadZone.onclick = () => fileInput.click();
uploadZone.ondragover = (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); };
uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
uploadZone.ondrop = (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
};
fileInput.onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'txt'].includes(ext)) {
    log('❌ Format tidak didukung. Gunakan PDF/DOCX/TXT.', 'err');
    return;
  }

  log(`📄 Membaca file: ${file.name}`, 'warn');
  setStatus('Membaca file...', '🟡');

  try {
    let text = '';
    if (ext === 'pdf') text = await parsePDF(file);
    else if (ext === 'docx') text = await parseDOCX(file);
    else text = await file.text();

    if (!text || text.trim().length < 20) throw new Error('Isi file kosong atau tidak terbaca.');

    state.materiText = text;
    state.fileName = file.name;

    fileName.textContent = file.name;
    fileItem.hidden = false;
    materiText.textContent = text;

    btnGenerate.disabled = false;
    log(`✅ File berhasil dibaca (${text.length} karakter).`, 'ok');
    log('▶ Klik "Generate Soal" untuk memulai.', 'dim');
    setStatus('File siap', '🟢');
  } catch (err) {
    log('❌ ' + err.message, 'err');
    setStatus('Gagal baca file', '🔴');
  }
}

// ====== PARSER PDF ======
async function parsePDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(x => x.str).join(' ') + '\n';
  }
  return text;
}

// ====== PARSER DOCX ======
async function parseDOCX(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

// ====== GENERATE SOAL ======
btnGenerate.onclick = async () => {
  const jumlahSoal = parseInt($('jumlahSoal').value) || 10;
  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="spinner"></span>Memproses...';
  setStatus('AI menganalisis...', '🟡');
  log('🤖 Mengirim ke Gemini AI...', 'warn');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: state.materiText, jumlahSoal })
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Gagal dari server.');

    state.kuisData = json.data;
    state.jumlahOpsi = json.data.jumlah_opsi || 5;
    state.currentIndex = 0;
    state.jawabanUser = [];

    log(`✅ AI selesai! Mode: ${json.data.mode}`, 'ok');
    log(`📝 ${json.data.soal.length} soal berhasil dibuat.`, 'ok');

    switchTab('kuis');
    renderQuiz();
    setStatus('Kuis siap', '🟢');
  } catch (err) {
    log('❌ ' + err.message, 'err');
    setStatus('Gagal generate', '🔴');
    viewKuis.innerHTML = `<div class="welcome"><div class="welcome-logo">⚠️</div><h1>Gagal</h1><p class="welcome-sub">${err.message}</p></div>`;
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '▶ Generate Soal';
  }
};

// ====== RENDER KUIS ======
function renderQuiz() {
  const { soal, judul } = state.kuisData;
  const idx = state.currentIndex;
  const total = soal.length;
  const q = soal[idx];

  const keys = Object.keys(q.pilihan).sort();
  const progress = ((idx) / total) * 100;

  let html = `
    <div class="quiz-container">
      <div class="quiz-header">
        <div class="quiz-title">${judul || 'Kuis Latihan'}</div>
        <div class="quiz-progress">Soal ${idx + 1} / ${total}</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      <div class="question">${escapeHtml(q.pertanyaan)}</div>
      <div class="pilihan-list" id="pilihanList">
  `;

  keys.forEach(k => {
    html += `
      <div class="pilihan" data-key="${k}">
        <div class="pilihan-key">${k}</div>
        <div class="pilihan-text">${escapeHtml(q.pilihan[k])}</div>
      </div>
    `;
  });

  html += `</div><div id="penjelasanBox"></div>
    <div class="quiz-actions">
      <button class="btn" id="btnPrev" ${idx === 0 ? 'disabled' : ''}>← Sebelumnya</button>
      <button class="btn primary" id="btnNext" disabled>${idx === total - 1 ? 'Selesai' : 'Selanjutnya →'}</button>
    </div></div>`;

  viewKuis.innerHTML = html;

  // Event pilihan
  let selectedKey = state.jawabanUser[idx] || null;
  const pilihanEls = document.querySelectorAll('.pilihan');

  if (selectedKey) {
    pilihanEls.forEach(el => {
      const k = el.dataset.key;
      el.classList.add('disabled');
      if (k === q.jawaban_benar) el.classList.add('correct');
      else if (k === selectedKey) el.classList.add('wrong');
      if (k === selectedKey) el.classList.add('selected');
    });
    showPenjelasan(q);
    $('btnNext').disabled = false;
  }

  pilihanEls.forEach(el => {
    el.onclick = () => {
      if (selectedKey) return;
      selectedKey = el.dataset.key;
      state.jawabanUser[idx] = selectedKey;

      pilihanEls.forEach(p => {
        p.classList.add('disabled');
        if (p.dataset.key === q.jawaban_benar) p.classList.add('correct');
        else if (p.dataset.key === selectedKey) p.classList.add('wrong');
      });
      el.classList.add('selected');
      showPenjelasan(q);
      $('btnNext').disabled = false;
      updateSkorSementara();
    };
  });

  // Nav
  $('btnPrev').onclick = () => { if (idx > 0) { state.currentIndex--; renderQuiz(); } };
  $('btnNext').onclick = () => {
    if (idx === total - 1) renderResult();
    else { state.currentIndex++; renderQuiz(); }
  };
}

function showPenjelasan(q) {
  const box = $('penjelasanBox');
  if (q.penjelasan) {
    box.innerHTML = `<div class="penjelasan"><b>💡 Penjelasan:</b> ${escapeHtml(q.penjelasan)}</div>`;
  }
}

function updateSkorSementara() {
  const soal = state.kuisData.soal;
  let benar = 0;
  soal.forEach((q, i) => {
    if (state.jawabanUser[i] === q.jawaban_benar) benar++;
  });
  statusSkor.textContent = `Skor: ${benar}/${soal.length}`;
}

// ====== HASIL AKHIR ======
function renderResult() {
  const soal = state.kuisData.soal;
  let benar = 0;
  soal.forEach((q, i) => {
    if (state.jawabanUser[i] === q.jawaban_benar) benar++;
  });
  const total = soal.length;
  const nilai = Math.round((benar / total) * 100);

  let emoji = '😢', msg = 'Perlu belajar lagi!';
  if (nilai >= 80) { emoji = '🏆'; msg = 'Luar biasa!'; }
  else if (nilai >= 60) { emoji = '👍'; msg = 'Bagus, terus tingkatkan!'; }

  viewKuis.innerHTML = `
    <div class="result">
      <div class="result-emoji">${emoji}</div>
      <h2>${msg}</h2>
      <div class="result-score">${nilai}</div>
      <div class="result-detail">Jawaban benar: ${benar} dari ${total}</div>
      <div class="quiz-actions" style="justify-content:center;">
        <button class="btn" id="btnReset">🔄 Ulangi Kuis</button>
        <button class="btn primary" id="btnNew">📄 Upload File Baru</button>
      </div>
    </div>
  `;

  statusSkor.textContent = `Skor: ${benar}/${total} (${nilai})`;
  setStatus('Kuis selesai', '🟢');
  log(`🎉 Kuis selesai. Skor: ${nilai} (${benar}/${total})`, 'ok');

  $('btnReset').onclick = () => {
    state.currentIndex = 0;
    state.jawabanUser = [];
    renderQuiz();
  };
  $('btnNew').onclick = () => {
    state = { ...state, kuisData: null, currentIndex: 0, jawabanUser: [], materiText: '', fileName: '' };
    fileItem.hidden = true;
    btnGenerate.disabled = true;
    viewKuis.innerHTML = `<div class="welcome"><div class="welcome-logo">🎓</div><h1>BelajarAI</h1><p class="welcome-sub">Upload file baru untuk memulai</p></div>`;
    statusSkor.textContent = 'Skor: -';
    setStatus('Siap', '🔵');
    fileInput.value = '';
  };
}

// ====== UTIL ======
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Init
log('BelajarAI v1.0.0 siap digunakan.', 'ok');
log('Menunggu file di-upload...', 'dim');