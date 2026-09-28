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
const fileRemove = $('fileRemove');
const sidebar = $('sidebar');
const overlay = $('overlay');
const panel = $('panel');

// ====== LUCIDE HELPER ======
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ====== MOBILE DRAWER ======
$('btnMenu').onclick = () => {
  sidebar.classList.add('open');
  overlay.classList.add('show');
};
overlay.onclick = () => {
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
};

$('panelToggle').onclick = () => {
  panel.classList.toggle('collapsed');
  setTimeout(refreshIcons, 50);
};

if (window.innerWidth <= 768) {
  panel.classList.add('collapsed');
}

// ==================================================
// ====== SFX (Web Audio API) ======
// ==================================================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('AudioContext tidak didukung:', e);
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.12, delay = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function playClickSfx() {
  playTone(1400, 0.06, 'square', 0.04, 0);
  playTone(1800, 0.05, 'square', 0.03, 0.04);
}

function playCorrectSfx() {
  playTone(880, 0.1, 'sine', 0.08, 0);
  playTone(1320, 0.15, 'sine', 0.08, 0.08);
}

function playWrongSfx() {
  playTone(400, 0.15, 'triangle', 0.08, 0);
  playTone(280, 0.25, 'triangle', 0.08, 0.12);
}

function playVictorySfx() {
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((f, i) => playTone(f, 0.4, 'sine', 0.12, i * 0.12));
  playTone(1568, 0.3, 'sine', 0.08, 0.6);
  playTone(2093, 0.5, 'sine', 0.06, 0.75);
}

function playSadSfx() {
  playTone(440, 0.3, 'triangle', 0.1, 0);
  playTone(392, 0.3, 'triangle', 0.1, 0.15);
  playTone(329.63, 0.6, 'triangle', 0.1, 0.3);
}

function playConfettiSfx() {
  for (let i = 0; i < 6; i++) {
    playTone(600 + i * 250, 0.12, 'sine', 0.05, i * 0.06);
  }
}

function playRemoveSfx() {
  playTone(600, 0.08, 'sawtooth', 0.05, 0);
  playTone(400, 0.12, 'sawtooth', 0.05, 0.08);
}

// Suara khusus Instagram (nada ceria pendek)
function playIgSfx() {
  playTone(659.25, 0.1, 'sine', 0.08, 0);
  playTone(880, 0.1, 'sine', 0.08, 0.09);
  playTone(1174.66, 0.15, 'sine', 0.08, 0.18);
}

// ==================================================
// ====== CONFETTI ======
// ==================================================
const CONFETTI_COLORS = ['#007acc', '#4ec9b0', '#dcdcaa', '#f48771', '#c586c0', '#ffffff'];

function fireConfetti(level = 'medium') {
  if (typeof confetti !== 'function') return;

  if (level === 'high') {
    confetti({
      particleCount: 120,
      spread: 100,
      origin: { y: 0.55 },
      colors: CONFETTI_COLORS,
      scalar: 1.1
    });

    const duration = 2500;
    const end = Date.now() + duration;
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 60,
        origin: { x: 0, y: 0.7 },
        colors: CONFETTI_COLORS
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 60,
        origin: { x: 1, y: 0.7 },
        colors: CONFETTI_COLORS
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  } else if (level === 'medium') {
    confetti({
      particleCount: 60,
      spread: 75,
      origin: { y: 0.6 },
      colors: CONFETTI_COLORS
    });
  } else {
    confetti({
      particleCount: 25,
      spread: 55,
      origin: { y: 0.65 },
      colors: CONFETTI_COLORS
    });
  }
}

// ==================================================
// ====== UTIL LOG ======
// ==================================================
function log(msg, type = '') {
  const div = document.createElement('div');
  div.className = 'term-line' + (type ? ' ' + type : '');
  div.textContent = '> ' + msg;
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}

function setStatus(text, color = 'green') {
  const colors = { green: '#4ec9b0', yellow: '#dcdcaa', red: '#f48771', blue: '#007acc' };
  const icon = $('statusIcon');
  if (icon) {
    icon.style.fill = colors[color] || colors.green;
    icon.style.stroke = colors[color] || colors.green;
  }
  statusText.textContent = text;
}

// ==================================================
// ====== CREATOR (Instagram) ======
// ==================================================
const creatorCard = $('creatorCard');
if (creatorCard) {
  creatorCard.onclick = () => {
    playIgSfx();
    log('Membuka Instagram @apap09_ ...', 'ok');
  };
}

// ==================================================
// ====== RESET FILE ======
// ==================================================
function resetFileState(silent = false) {
  state.materiText = '';
  state.fileName = '';
  state.kuisData = null;
  state.currentIndex = 0;
  state.jawabanUser = [];

  fileItem.hidden = true;
  fileName.textContent = '-';
  materiText.textContent = 'Belum ada materi yang di-upload.';
  btnGenerate.disabled = true;
  fileInput.value = '';
  statusSkor.textContent = 'Skor: -';

  viewKuis.innerHTML = `<div class="welcome">
    <i data-lucide="graduation-cap" class="welcome-logo"></i>
    <h1>NugasAI</h1>
    <p class="welcome-sub">Upload file materi / soal untuk memulai</p>
    <div class="welcome-steps">
      <div class="step"><span class="step-num">1</span> Upload file materi / soal</div>
      <div class="step"><span class="step-num">2</span> Klik <b>Generate kuis</b></div>
      <div class="step"><span class="step-num">3</span> Kerjakan kuis</div>
    </div>
  </div>`;

  switchTab('kuis');

  if (!silent) setStatus('File dihapus', 'yellow');
  refreshIcons();
}

// ==================================================
// ====== TOMBOL HAPUS FILE ======
// ==================================================
fileRemove.onclick = (e) => {
  e.stopPropagation();
  e.preventDefault();
  playRemoveSfx();
  resetFileState();
  log('File dihapus. Silakan upload file baru.', 'warn');
  refreshIcons();
};

// ====== TAB SWITCHING ======
$('tabSoal').onclick = () => switchTab('kuis');
$('tabMateri').onclick = () => switchTab('materi');
function switchTab(tab) {
  if (tab === 'kuis') {
    $('tabSoal').classList.add('active');
    $('tabMateri').classList.remove('active');
    viewKuis.hidden = false;
    viewMateri.hidden = true;
    $('breadcrumb').textContent = 'nugas-ai › kuis.json';
  } else {
    $('tabMateri').classList.add('active');
    $('tabSoal').classList.remove('active');
    viewKuis.hidden = true;
    viewMateri.hidden = false;
    $('breadcrumb').textContent = 'nugas-ai › materi.txt';
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
    log('Format tidak didukung. Gunakan PDF/DOCX/TXT.', 'err');
    return;
  }

  resetFileState(true);

  log(`Membaca file: ${file.name}`, 'warn');
  setStatus('Membaca file...', 'yellow');

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
    log(`File berhasil dibaca (${text.length} karakter).`, 'ok');
    log('Klik "Generate Kuis" untuk memulai.', 'dim');
    setStatus('File siap', 'green');
    refreshIcons();

    if (window.innerWidth <= 768) {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    }
  } catch (err) {
    log(err.message, 'err');
    setStatus('Gagal baca file', 'red');
  }
}

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

async function parseDOCX(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

// ====== GENERATE ======
btnGenerate.onclick = async () => {
  const jumlahSoal = parseInt($('jumlahSoal').value) || 10;
  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="spinner"></span> Memproses...';
  setStatus('AI menganalisis...', 'yellow');
  log('Mengirim ke Gemini AI...', 'warn');

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

    log(`AI selesai! Mode: ${json.data.mode}`, 'ok');
    log(`${json.data.soal.length} soal berhasil dibuat.`, 'ok');

    switchTab('kuis');
    renderQuiz();
    setStatus('Kuis siap', 'green');
  } catch (err) {
    log(err.message, 'err');
    setStatus('Gagal generate', 'red');
    viewKuis.innerHTML = `<div class="welcome">
      <i data-lucide="alert-triangle" class="welcome-logo" style="color:#dcdcaa;"></i>
      <h1>Gagal</h1>
      <p class="welcome-sub">${err.message}</p>
    </div>`;
    refreshIcons();
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<i data-lucide="play"></i> Generate Kuis';
    refreshIcons();
  }
};

// ====== RENDER QUIZ ======
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
      <button class="btn" id="btnPrev" ${idx === 0 ? 'disabled' : ''}>
        <i data-lucide="chevron-left"></i> Sebelumnya
      </button>
      <button class="btn primary" id="btnNext" disabled>
        ${idx === total - 1 ? 'Selesai' : 'Selanjutnya'} <i data-lucide="chevron-right"></i>
      </button>
    </div></div>`;

  viewKuis.innerHTML = html;

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

      if (selectedKey === q.jawaban_benar) playCorrectSfx();
      else playWrongSfx();

      showPenjelasan(q);
      $('btnNext').disabled = false;
      updateSkorSementara();
      refreshIcons();
    };
  });

  $('btnPrev').onclick = () => {
    playClickSfx();
    if (idx > 0) { state.currentIndex--; renderQuiz(); }
  };
  $('btnNext').onclick = () => {
    playClickSfx();
    if (idx === total - 1) renderResult();
    else { state.currentIndex++; renderQuiz(); }
  };

  refreshIcons();
}

function showPenjelasan(q) {
  const box = $('penjelasanBox');
  if (q.penjelasan) {
    box.innerHTML = `<div class="penjelasan">
      <i data-lucide="lightbulb"></i>
      <div><b>Penjelasan:</b> ${escapeHtml(q.penjelasan)}</div>
    </div>`;
    refreshIcons();
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

// ==================================================
// ====== RESULT + CONFETTI + SFX ======
// ==================================================
function renderResult() {
  const soal = state.kuisData.soal;
  let benar = 0;
  soal.forEach((q, i) => {
    if (state.jawabanUser[i] === q.jawaban_benar) benar++;
  });
  const total = soal.length;
  const nilai = Math.round((benar / total) * 100);

  let icon = 'frown', color = '#f48771', msg = 'Perlu belajar lagi!';
  if (nilai >= 80) { icon = 'trophy'; color = '#dcdcaa'; msg = 'Luar biasa!'; }
  else if (nilai >= 60) { icon = 'thumbs-up'; color = '#4ec9b0'; msg = 'Bagus, terus tingkatkan!'; }

  viewKuis.innerHTML = `
    <div class="result">
      <i data-lucide="${icon}" class="result-emoji" style="color:${color};"></i>
      <h2>${msg}</h2>
      <div class="result-score">${nilai}</div>
      <div class="result-detail">Jawaban benar: ${benar} dari ${total}</div>
      <div class="quiz-actions" style="justify-content:center;">
        <button class="btn" id="btnReset"><i data-lucide="rotate-ccw"></i> Ulangi Kuis</button>
        <button class="btn primary" id="btnNew"><i data-lucide="upload"></i> Upload File Baru</button>
      </div>
    </div>
  `;

  statusSkor.textContent = `Skor: ${benar}/${total} (${nilai})`;
  setStatus('Kuis selesai', 'green');
  log(`Kuis selesai. Skor: ${nilai} (${benar}/${total})`, 'ok');
  refreshIcons();

  if (nilai >= 80) {
    log('Sempurna! Confetti!', 'ok');
    playVictorySfx();
    playConfettiSfx();
    setTimeout(() => fireConfetti('high'), 150);
  } else if (nilai >= 60) {
    log('Bagus! Pertahankan!', 'ok');
    playVictorySfx();
    fireConfetti('medium');
  } else {
    log('Jangan menyerah, coba lagi!', 'warn');
    playSadSfx();
    fireConfetti('low');
  }

  $('btnReset').onclick = () => {
    playClickSfx();
    state.currentIndex = 0;
    state.jawabanUser = [];
    renderQuiz();
  };
  $('btnNew').onclick = () => {
    playClickSfx();
    resetFileState(true);
    log('Silakan upload file baru.', 'dim');
    setStatus('Siap', 'green');
    refreshIcons();
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

// ====== INIT ======
log('Nugas.AI v1 siap digunakan.', 'ok');
log('Menunggu file di-upload...', 'dim');
refreshIcons();