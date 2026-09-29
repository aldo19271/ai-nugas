
# Nugas.AI

Website buat bikin soal latihan dari file materi. Upload PDF/DOCX/TXT, AI baca isinya, terus dikasih soal pilihan ganda.

Live: https://ai-nugas.vercel.app

## Kenapa bikin ini

Bosen baca materi berulang-ulang buat persiapan ujian. Daripada bikin soal sendiri, mending suruh AI.

## Cara pakai

1. Buka website
2. Klik menu di kiri atas
3. Upload file (PDF, DOCX, atau TXT)
4. Klik Generate Kuis
5. Kerjakan

Kalau file cuma berisi materi, soal dibuat dari nol. Kalau file udah ada soal + pilihan ganda, ya langsung diambil.

## Yang dipakai

- HTML, CSS, JavaScript (frontend)
- Node.js + Express (backend)
- Google Gemini + Groq (AI-nya pakai dua, biar kalau satu limit masih jalan)
- PDF.js sama Mammoth buat baca file
- Di-deploy di Vercel

## Jalanin di lokal

```

git clone https://github.com/aldo19271/ai-nugas.git
cd ai-nugas
npm install

```

Bikin file `.env`:

```

GEMINI_API_KEY=...
GROQ_API_KEY=...

```

Terus:

```

npm start

```

Buka `localhost:3000`.

API key-nya bisa didapat di:
- Gemini: https://aistudio.google.com/app/apikey
- Groq: https://console.groq.com

## Deploy

Push ke GitHub, import di Vercel, set dua environment variable di atas, deploy.


## Struktur

```

api/index.js        backend
public/index.html   UI
public/style.css    tema
public/script.js    logika kuis
vercel.json         config deploy

```

## Creator

al 
https://www.instagram.com/apap09_?stkn=MXd2YjRybTFzcnFybA==

Lisensi MIT. Pakai bebas.

