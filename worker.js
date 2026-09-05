// ============================================================================
// JOYBOT — CLOUDFLARE WORKER (Reverse Proxy + Auto Maintenance Page)
// ============================================================================
// SEMUA SETTINGAN ada di blok CONFIG di bawah ini. Edit di sini aja kalau
// mau ganti alamat server, port, link kontak, dll — gak perlu isi apapun
// lewat menu "Variables" di dashboard Cloudflare (dan gak akan pernah
// kereset/ilang tiap kali deploy ulang, beda dari cara Variables).
// ============================================================================
const CONFIG = {
  // Alamat server Joybot. Sengaja pakai subdomain "origin.joybot.web.id"
  // (bukan IP langsung) -> kalau nanti pindah VPS, CUKUP update 1 DNS
  // record "origin" di Cloudflare, gak perlu sentuh kode ini sama sekali.
  ORIGIN_URL: "http://origin.joybot.web.id:3000",

  // Batas waktu (ms) nunggu jawaban server sebelum dianggap "mati" dan
  // nampilin halaman maintenance. 30 detik -- sengaja gak dibikin pendek,
  // karena proses kayak generate kode pairing WhatsApp butuh waktu lumayan
  // (server harus connect dulu ke WhatsApp). Kalau kependekan, request yang
  // masih diproses normal malah keburu diputus dan dikira server mati.
  ORIGIN_TIMEOUT_MS: 30000,

  SITE_NAME: "Joybot",
  OWNER_WA_URL: "https://wa.me/6285166615736",
  OWNER_TG_URL: "https://t.me/mamzishere",
  CHANNEL_WA_URL: "https://whatsapp.com/channel/0029Vb7wv9bGk1FkazxWBz1M",
  CHANNEL_TG_URL: "https://t.me/joybot_official",
  GROUP_WA_URL: "https://chat.whatsapp.com/DiNJATLsvbdL1eQYlUAmo0",
  GROUP_TG_URL: "https://t.me/joybot_roomchat",

  // Halaman polling diam-diam ke server tiap sekian detik. Begitu server
  // hidup lagi, tab otomatis reload sendiri -- orang yang lagi nunggu gak
  // perlu mantengin/refresh manual. Ada juga tombol "Cek Sekarang" buat
  // yang gak sabar nunggu countdown.
  AUTO_RETRY_SECONDS: 15,
};

export default {
  async fetch(request, env, ctx) {
    const timeoutMs = Number(CONFIG.ORIGIN_TIMEOUT_MS || 30000);

    try {
      const incoming = new URL(request.url);
      const origin = new URL(CONFIG.ORIGIN_URL);
      origin.pathname = incoming.pathname;
      origin.search = incoming.search;

      // FIX: forward info visitor asli ke server Joybot lewat header
      // X-Forwarded-*. Tanpa ini, server (yang pakai `trust proxy` + req.ip
      // buat rate-limit & verifikasi Cloudflare Turnstile) bakal ngira SEMUA
      // pengunjung datang dari 1 alamat yang sama -> rate limit jadi salah
      // sasaran/gampang ke-trigger, dan verifikasi captcha bisa gagal random.
      const headers = new Headers(request.headers);
      const clientIp = request.headers.get('CF-Connecting-IP') || '';
      if (clientIp) {
        headers.set('X-Forwarded-For', clientIp);
        headers.set('X-Real-IP', clientIp);
      }
      headers.set('X-Forwarded-Proto', 'https');
      headers.set('X-Forwarded-Host', incoming.hostname);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let originResponse;
      try {
        originResponse = await fetch(origin.toString(), {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // FIX: fetch() ke origin bisa "sukses" (gak nge-throw) tapi isinya
      // halaman error dari Cloudflare sendiri (521/522/523/525/dst) --
      // biasanya kalau record `origin` gak sengaja ke-set Proxied (harusnya
      // DNS only), atau origin beneran nolak koneksi. Response kayak gini
      // status-nya >=500 -> anggap sama kayak server mati, tampilin
      // maintenance page kita sendiri, bukan halaman error mentah Cloudflare.
      if (originResponse.status >= 500) {
        return maintenancePage();
      }

      return originResponse;
    } catch (err) {
      // Server gak kejangkau / timeout / down beneran -> maintenance page.
      return maintenancePage();
    }
  },
};

function maintenancePage() {
  const siteName = CONFIG.SITE_NAME || 'Joybot';
  const retrySeconds = Number(CONFIG.AUTO_RETRY_SECONDS || 15);

  const ownerWa = CONFIG.OWNER_WA_URL || '';
  const ownerTg = CONFIG.OWNER_TG_URL || '';
  const channelWa = CONFIG.CHANNEL_WA_URL || '';
  const channelTg = CONFIG.CHANNEL_TG_URL || '';
  const groupWa = CONFIG.GROUP_WA_URL || '';
  const groupTg = CONFIG.GROUP_TG_URL || '';

  // FIX: icon WA/Telegram sekarang polos tanpa kotak/bingkai tambahan --
  // persis pola ".dev-link-ic.brand" di web app aslinya (icon brand sudah
  // punya bentuk rounded-square/circle sendiri, gak perlu dibungkus lagi
  // biar gak keliatan "double-boxed" / seperti di-zoom.
  const link = (url, kind, label, sub) => url
    ? `<a class="dl ${kind}" href="${esc(url)}" target="_blank" rel="noopener">
         <span class="dl-ic">${kind === 'wa' ? ICON_WA : ICON_TG}</span>
         <span class="dl-txt"><span class="dl-sub">${esc(sub)}</span><span class="dl-label">${esc(label)}</span></span>
         <svg class="dl-go" viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
       </a>`
    : '';

  const ownerBlock = (ownerWa || ownerTg) ? `
      <div class="section-title">Hubungi Owner</div>
      <div class="grid">
        ${link(ownerWa, 'wa', 'WhatsApp', 'Owner')}
        ${link(ownerTg, 'tg', 'Telegram', 'Owner')}
      </div>` : '';

  const channelBlock = (channelWa || channelTg) ? `
      <div class="section-title">Channel Resmi</div>
      <div class="grid">
        ${link(channelWa, 'wa', 'WhatsApp', 'Channel')}
        ${link(channelTg, 'tg', 'Telegram', 'Channel')}
      </div>` : '';

  const groupBlock = (groupWa || groupTg) ? `
      <div class="section-title">Grup Komunitas</div>
      <div class="grid">
        ${link(groupWa, 'wa', 'WhatsApp', 'Grup')}
        ${link(groupTg, 'tg', 'Telegram', 'Grup')}
      </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(siteName)} — Sedang Maintenance</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<script>
// Anti-flash: samain persis logika theme.js web utama, kunci localStorage
// yang sama ("jb-theme") -> preferensi tema orang tetap konsisten walau
// lagi mampir ke halaman maintenance ini.
(function(){
  try {
    if (localStorage.getItem('jb-theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {}
})();
</script>
<style>
:root{
  color-scheme:dark;
  --bg:#060B09; --bg-soft:#0A100D; --surface:#101A16; --surface-hi:#172420;
  --border:rgba(255,255,255,.09); --border-strong:rgba(255,255,255,.18);
  --ink:#EAFBF2; --muted:#8FA79C; --muted-dim:#5C7269;
  --green:#22FF8E; --green-deep:#0F7A4A; --green-soft:rgba(34,255,142,.14);
  --blue:#3FA9FF; --blue-soft:rgba(63,169,255,.14);
  --pink:#FF4FA0; --amber:#FFC845;
  --display:'Space Grotesk', sans-serif; --body:'Inter', sans-serif; --mono:'JetBrains Mono', monospace;
  --radius-lg:20px; --radius-md:14px; --radius-sm:10px;
  --glow-green:0 0 50px -12px rgba(34,255,142,.45);
}
[data-theme="light"]{
  color-scheme:light;
  --bg:#F3FAF6; --bg-soft:#EAF5EF; --surface:#FFFFFF; --surface-hi:#F0F7F3;
  --border:rgba(11,31,22,.08); --border-strong:rgba(11,31,22,.16);
  --ink:#0B1F16; --muted:#556B62; --muted-dim:#7C8F86;
  --green:#0FCC72; --green-deep:#0A8F53; --green-soft:rgba(15,204,114,.12);
  --blue:#1C86E0; --blue-soft:rgba(28,134,224,.12);
  --pink:#E0348A; --amber:#B5790A;
  --glow-green:0 0 40px -10px rgba(15,204,114,.4);
}
*{box-sizing:border-box;}
html{background:var(--bg);}
body{
  margin:0; min-height:100vh; font-family:var(--body); color:var(--ink);
  background:
    radial-gradient(900px 480px at 50% -10%, rgba(34,255,142,.10), transparent 60%),
    var(--bg);
  -webkit-font-smoothing:antialiased;
}
a{text-decoration:none; color:inherit;}

/* ---------- navbar (samain sama nav web utama) ---------- */
.nav{
  position:sticky; top:0; z-index:50; display:flex; align-items:center; justify-content:space-between;
  padding:14px 20px; background:var(--nav-bg, rgba(6,11,9,.82)); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--border);
}
[data-theme="light"] .nav{--nav-bg:rgba(243,250,246,.85);}
.brand{display:flex; align-items:center; gap:9px; font-family:var(--display); font-weight:700; font-size:16.5px;}
.brand-mark{
  width:30px; height:30px; border-radius:9px; background:var(--green-soft); border:1px solid rgba(34,255,142,.35);
  display:flex; align-items:center; justify-content:center; color:var(--green); flex:none;
}
.brand-mark svg{width:17px; height:17px;}
.brand .online-dot{width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 3px var(--green-soft); flex:none; margin-left:1px;}
.theme-toggle{
  width:38px; height:38px; border-radius:10px; border:1px solid var(--border-strong);
  background:var(--surface); color:var(--ink); display:flex; align-items:center; justify-content:center;
  cursor:pointer; flex:none; padding:0; transition:border-color .15s ease, transform .15s ease;
}
.theme-toggle:hover{border-color:var(--green); transform:translateY(-1px);}
.theme-toggle svg{width:17px; height:17px;}
.theme-toggle .icon-sun{display:none;}
[data-theme="light"] .theme-toggle .icon-moon{display:none;}
[data-theme="light"] .theme-toggle .icon-sun{display:block;}

/* ---------- hero / card ---------- */
.hero-wrap{position:relative; padding:36px 18px 40px; display:flex; justify-content:center;}
.pulse-bg{
  position:absolute; left:50%; top:6%; width:560px; height:560px; transform:translateX(-50%);
  border-radius:50%; pointer-events:none; z-index:0;
  background:radial-gradient(circle, rgba(34,255,142,.14) 0%, rgba(34,255,142,.04) 40%, transparent 70%);
}
.pulse-bg::before, .pulse-bg::after{
  content:''; position:absolute; inset:0; border-radius:50%; border:1px solid rgba(34,255,142,.16);
  animation:pulse-ring 3.2s ease-out infinite;
}
.pulse-bg::after{animation-delay:1.6s;}
@keyframes pulse-ring{0%{transform:scale(.55); opacity:.9;} 100%{transform:scale(1); opacity:0;}}
@media (prefers-reduced-motion: reduce){.pulse-bg::before,.pulse-bg::after{animation:none; display:none;}}

.wrap{max-width:440px; width:100%; position:relative; z-index:1;}
.card{
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg);
  padding:30px 26px 26px; text-align:center; box-shadow:0 40px 90px -30px rgba(0,0,0,.5);
}
.pill{
  display:inline-flex; align-items:center; gap:8px; font-family:var(--body); font-weight:600;
  font-size:12.5px; color:var(--green); background:var(--green-soft);
  border:1px solid rgba(34,255,142,.4); padding:7px 14px; border-radius:100px; margin-bottom:18px;
}
.pill .dot{width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 8px var(--green); animation:blink 1.8s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1;} 50%{opacity:.35;}}

h1{font-family:var(--display); font-size:22px; margin:0 0 10px; font-weight:700; letter-spacing:-.01em;}
h1 mark{background:none; color:var(--green);}
p.desc{font-size:14.5px; line-height:1.65; color:var(--muted); margin:0 0 4px;}

.status-row{
  margin-top:18px; display:flex; align-items:stretch; gap:8px;
}
.retry-line{
  flex:1; display:flex; align-items:center; justify-content:center; gap:7px; font-family:var(--mono);
  font-size:11.5px; color:var(--muted-dim); background:var(--surface-hi); border:1px solid var(--border);
  padding:9px 10px; border-radius:var(--radius-sm);
}
.retry-line svg{width:13px; height:13px; flex:none;}
.retry-line svg.spin{animation:spin 1.6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.btn-check{
  display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap;
  padding:9px 14px; border-radius:var(--radius-sm); font-family:var(--body); font-weight:600; font-size:12.5px;
  border:1px solid var(--border-strong); background:transparent; color:var(--ink); cursor:pointer;
  transition:border-color .15s ease, box-shadow .15s ease;
}
.btn-check:hover{border-color:var(--green); box-shadow:0 0 0 1px var(--green) inset;}
.btn-check:active{transform:scale(.97);}
.btn-check svg{width:13px; height:13px;}
.elapsed{
  margin-top:10px; font-family:var(--mono); font-size:11px; color:var(--muted-dim);
}
.elapsed b{color:var(--muted); font-weight:600;}

.section-title{
  font-family:var(--display); font-weight:600; font-size:12px; color:var(--muted);
  text-transform:uppercase; letter-spacing:.06em; text-align:left; margin:22px 0 10px;
}
.grid{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
.dl{
  position:relative; display:flex; align-items:center; gap:10px; padding:11px 30px 11px 12px; border-radius:var(--radius-md);
  border:1px solid var(--border-strong); background:var(--surface-hi); text-align:left;
  transition:border-color .15s ease, transform .15s ease, background .15s ease;
}
.dl:hover{border-color:var(--green); transform:translateY(-1px); background:rgba(34,255,142,.06);}
.dl-ic{width:26px; height:26px; flex:none; display:flex; align-items:center; justify-content:center;}
.dl-ic svg{width:26px; height:26px; display:block;}
.dl-txt{display:flex; flex-direction:column; gap:1px; min-width:0;}
.dl-sub{font-size:10px; color:var(--muted-dim); font-weight:600;}
.dl-label{font-family:var(--display); font-size:13px; font-weight:600; color:var(--ink);}
.dl-go{position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--muted-dim); flex:none;}

.foot{margin-top:24px; font-size:11.5px; color:var(--muted-dim);}
</style>
</head>
<body>
  <div class="nav">
    <div class="brand">
      <span class="brand-mark">${ICON_BOT}</span>
      <span>${esc(siteName)}</span>
      <span class="online-dot"></span>
    </div>
    <button class="theme-toggle" id="themeToggleBtn" type="button" aria-label="Ganti tema terang/gelap">
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    </button>
  </div>

  <div class="hero-wrap">
    <div class="pulse-bg"></div>
    <div class="wrap">
      <div class="card">
        <div class="pill"><span class="dot"></span> Sedang Maintenance</div>
        <h1>Server lagi <mark>istirahat</mark> sebentar</h1>
        <p class="desc">Kami sedang melakukan perbaikan/pemeliharaan. Halaman ini otomatis kembali normal begitu server nyala — gak perlu refresh manual. Sambil nunggu, pantau info update lewat channel resmi ya.</p>

        <div class="status-row">
          <div class="retry-line" id="retryLine">
            <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>
            <span id="retryText">cek ulang tiap ${retrySeconds}d</span>
          </div>
          <button class="btn-check" id="btnCheck" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>
            Cek Sekarang
          </button>
        </div>
        <div class="elapsed">Dipantau sejak dibuka: <b id="elapsedTime">00:00</b></div>

        ${ownerBlock}
        ${channelBlock}
        ${groupBlock}
        <div class="foot">© ${new Date().getFullYear()} ${esc(siteName)} — kembali normal secara otomatis</div>
      </div>
    </div>
  </div>

<script>
(function(){
  // --- Tema (samain kunci & perilaku persis theme.js web utama) ---
  var STORAGE_KEY = 'jb-theme';
  function getTheme(){ try { return localStorage.getItem(STORAGE_KEY) || 'dark'; } catch(e){ return 'dark'; } }
  function applyTheme(t){
    if (t === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
  }
  function setTheme(t){ applyTheme(t); try { localStorage.setItem(STORAGE_KEY, t); } catch(e){} }
  var themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) themeBtn.addEventListener('click', function(){ setTheme(getTheme() === 'light' ? 'dark' : 'light'); });

  // --- Auto-retry countdown + tombol cek manual ---
  var seconds = ${JSON.stringify(retrySeconds)};
  var label = document.getElementById('retryText');
  var left = seconds;
  var checking = false;

  function doCheck(){
    if (checking) return;
    checking = true;
    if (label) label.textContent = 'mengecek...';
    fetch(window.location.href, { cache: 'no-store' }).then(function(res){
      if (res.status < 500) {
        window.location.reload();
        return;
      }
      checking = false;
      left = seconds;
      if (label) label.textContent = 'cek ulang tiap ' + seconds + 'd';
    }).catch(function(){
      checking = false;
      left = seconds;
      if (label) label.textContent = 'cek ulang tiap ' + seconds + 'd';
    });
  }

  function tick(){
    if (checking) return;
    left -= 1;
    if (left <= 0) doCheck();
    else if (label) label.textContent = 'cek ulang dlm ' + left + 'd';
  }
  setInterval(tick, 1000);

  var btnCheck = document.getElementById('btnCheck');
  if (btnCheck) btnCheck.addEventListener('click', doCheck);

  // --- Durasi dipantau sejak halaman dibuka ---
  var startedAt = Date.now();
  var elapsedEl = document.getElementById('elapsedTime');
  function pad(n){ return String(n).padStart(2,'0'); }
  setInterval(function(){
    if (!elapsedEl) return;
    var s = Math.floor((Date.now() - startedAt) / 1000);
    var m = Math.floor(s / 60);
    elapsedEl.textContent = pad(m) + ':' + pad(s % 60);
  }, 1000);
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store', 'retry-after': String(retrySeconds) },
  });
}

function esc(s) {
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

// FIX: icon WA & Telegram persis sama kayak yang dipakai di web dashboard
// Joybot (lihat web/public/icons.js) -- rounded-square hijau utk WhatsApp,
// circle biru utk Telegram, konsisten sama branding app.
const ICON_WA = '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="1" y="1" width="22" height="22" rx="6.5" fill="#25D366"/><path fill="#fff" d="M12 3.9c-4.6 0-8.3 3.7-8.3 8.3 0 1.5.4 2.9 1.1 4.1L3.6 20.4l4.3-1.1c1.2.6 2.6 1 4.1 1 4.6 0 8.3-3.7 8.3-8.3s-3.7-8.1-8.3-8.1Zm0 15.1c-1.3 0-2.6-.4-3.6-1l-.3-.1-2.6.7.7-2.5-.2-.3a6.6 6.6 0 0 1-1-3.5c0-3.6 3-6.6 6.7-6.6s6.7 3 6.7 6.6-3 6.7-6.7 6.7Zm3.6-5c-.2-.1-1.2-.6-1.3-.6-.2-.1-.3-.1-.4.1s-.5.6-.6.7c-.1.1-.2.1-.4 0-.2-.1-.8-.3-1.5-1-.6-.5-1-1.1-1.1-1.3-.1-.2 0-.3.1-.4l.3-.3c.1-.1.1-.2.2-.4 0-.1 0-.3 0-.4 0-.1-.4-1.1-.6-1.5-.2-.4-.3-.3-.4-.3h-.4c-.1 0-.3 0-.5.3-.2.2-.7.7-.7 1.8s.7 2.1.8 2.3c.1.1 1.5 2.4 3.7 3.3.5.2.9.4 1.2.5.5.2.9.1 1.3.1.4-.1 1.2-.5 1.3-1 .2-.4.2-.8.1-.9 0-.1-.2-.2-.4-.3Z"/></svg>';
const ICON_TG = '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="11" fill="#29A9EB"/><path fill="#fff" d="M5.4 12.1 17.6 7.1c.6-.2 1.1.1.9.9l-2.1 9.9c-.1.6-.5.7-1 .4l-2.9-2.1-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.3-.1l-6.9 4.3-3-.9c-.6-.2-.6-.6.2-.9Z"/></svg>';
// Ikon kecil buat brand mark di navbar (glyph chat/bot generik, netral).
const ICON_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3"/><rect x="5" y="8" width="14" height="11" rx="3"/><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none"/><path d="M9 17.5h6"/></svg>';
