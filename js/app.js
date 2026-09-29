/**
 * ============================================================
 * GeoFoto Lahan v3 — Frontend JavaScript (GitHub Pages)
 * ------------------------------------------------------------
 * Alur satu titik:
 *   1. Titik = posisi GPS (atau digeser/diketuk di peta mini)
 *   2. (Opsional) foto lapangan dari kamera → diberi watermark
 *   3. Simpan: citra satelit Google diambil server → diberi panel
 *      keterangan + skala + arah utara → dikirim bersama foto ke
 *      Drive, lalu dicatat di Google Sheets
 *   4. Jika tidak ada internet, titik antre di HP (IndexedDB) dan
 *      dikirim otomatis saat online
 * Backend dipanggil lewat fetch() — lihat js/api.js & js/config.js
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// BAGIAN 1: STATE & PENGATURAN
// ════════════════════════════════════════════════════════

const PENGATURAN_DEFAULT = {
  tema: 'light',
  zoom: '18',
  resolusi: '2048',
  kualitas: '0.9',
  alamat: true,
  teksTambahan: ''
};

const TILE_SATELIT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_JALAN = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const state = {
  pengaturan: {},
  posisi: null,           // posisi GPS terbaru
  titik: null,            // { lat, lng, mode: 'gps' | 'peta' }
  db: null,
  memori: { antrean: {}, cache: {} },   // cadangan bila IndexedDB tidak tersedia
  daftar: [],             // titik yang sudah tersimpan di Sheets
  antrean: [],            // titik yang belum terkirim (di HP)
  info: null,             // link spreadsheet & folder
  fotoDraft: null,
  terakhir: null,
  petaMini: null, pinMini: null, kotakMini: null,
  peta: null, layerTitik: null, markerById: {},
  lokasiSaya: {},         // penanda posisi saya per peta
  detail: { rec: null, aktif: 'citra', url: {}, blobUrl: [] },
  cacheGambar: {},        // fileId → dataURL
  hapusTarget: null,
  sedangProses: false,
  sedangSinkron: false
};

let modalDetail, modalHapus, modalKoneksi, toastApp;
const byId = (id) => document.getElementById(id);

function bacaLokal(kunci, bawaan) {
  try { const v = localStorage.getItem(kunci); return v ? JSON.parse(v) : bawaan; } catch (e) { return bawaan; }
}
function simpanLokal(kunci, nilai) {
  try { localStorage.setItem(kunci, JSON.stringify(nilai)); } catch (e) { /* abaikan */ }
}
function simpanPengaturan() { simpanLokal('geofoto_pengaturan_v2', state.pengaturan); }

// ════════════════════════════════════════════════════════
// BAGIAN 2: INISIALISASI
// ════════════════════════════════════════════════════════

async function initApp() {
  try {
    state.pengaturan = Object.assign({}, PENGATURAN_DEFAULT, bacaLokal('geofoto_pengaturan_v2', {}));
    terapkanTema(state.pengaturan.tema);

    if (typeof bootstrap === 'undefined') {
      throw new Error('Komponen tampilan gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.');
    }
    modalDetail = new bootstrap.Modal(byId('modalDetail'));
    modalHapus = new bootstrap.Modal(byId('modalHapus'));
    modalKoneksi = new bootstrap.Modal(byId('modalKoneksi'));
    toastApp = new bootstrap.Toast(byId('appToast'), { delay: 5000 });

    isiFormPengaturan();
    pasangEvent();

    try { state.db = await bukaDB(); }
    catch (e) {
      state.db = null;
      showToast('Penyimpanan HP terbatas', 'Titik yang gagal terkirim hanya bertahan selama halaman ini terbuka.', 'warning');
    }

    initPetaMini();
    mulaiGPS();
    setInterval(renderUmurGPS, 1000);

    // Tampilkan data tersimpan di HP dulu (cepat, bisa offline), lalu segarkan dari server
    state.antrean = await dbSemua('antrean');
    const cache = await dbAmbil('cache', 'daftar');
    state.daftar = cache && Array.isArray(cache.data) ? cache.data : [];
    renderSemua();
  } catch (err) {
    byId('loadingOverlay').innerHTML = '<div class="logo-besar"><i class="bi bi-wifi-off"></i></div>' +
      '<p class="mt-3 px-4 text-center">' + esc(err.message) + '</p>' +
      '<button type="button" class="btn btn-accent px-4" onclick="location.reload()">Muat ulang</button>';
    return;
  }
  sembunyikanLoading();
  daftarkanServiceWorker();

  updateIndikatorOnline();
  if (!adaServer()) {
    setTimeout(() => bukaModalKoneksi('Selamat datang! Hubungkan aplikasi ke Google Drive & Sheets Anda dulu.'), 400);
  } else {
    muatInfoServer();
    muatDaftar(false);
    prosesAntrean(false);
  }
  setInterval(() => { if (state.antrean.length && navigator.onLine) prosesAntrean(false); }, 60000);
}

function sembunyikanLoading() {
  const el = byId('loadingOverlay');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

function pasangEvent() {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  byId('btnTema').addEventListener('click', () => {
    state.pengaturan.tema = state.pengaturan.tema === 'dark' ? 'light' : 'dark';
    simpanPengaturan(); terapkanTema(state.pengaturan.tema);
    byId('aturTema').checked = state.pengaturan.tema === 'dark';
  });

  window.addEventListener('online', () => { updateIndikatorOnline(); prosesAntrean(false); muatDaftar(false); });
  window.addEventListener('offline', updateIndikatorOnline);

  // Ambil titik
  byId('btnIkutiGps').addEventListener('click', ikutiGPS);
  byId('btnHapusKet').addEventListener('click', () => { byId('inputKeterangan').value = ''; byId('inputKeterangan').focus(); });
  byId('btnAmbilFoto').addEventListener('click', ambilFoto);
  byId('btnUlangiFoto').addEventListener('click', ambilFoto);
  byId('btnHapusFoto').addEventListener('click', () => { state.fotoDraft = null; renderFotoDraft(); });
  byId('inputKamera').addEventListener('change', onFotoDipilih);
  byId('btnSimpanTitik').addEventListener('click', simpanTitikBaru);
  byId('btnDetailHasil').addEventListener('click', () => state.terakhir && bukaDetail(state.terakhir.id));

  // Riwayat
  byId('daftarRiwayat').addEventListener('click', (e) => {
    const kartu = e.target.closest('.kartu-foto');
    if (kartu) bukaDetail(kartu.dataset.id);
  });
  byId('btnKirimAntre').addEventListener('click', () => prosesAntrean(true));
  byId('btnMuatUlang').addEventListener('click', () => muatDaftar(true));
  byId('btnEksporKml').addEventListener('click', eksporKML);

  // Peta
  byId('btnLokasiSaya').addEventListener('click', () => {
    if (!state.peta) return;
    if (!state.posisi) { showToast('GPS belum siap', 'Lokasi Anda belum terdeteksi.', 'warning'); return; }
    state.peta.setView([state.posisi.lat, state.posisi.lng], Math.max(state.peta.getZoom(), 17));
  });
  byId('btnSemuaTitik').addEventListener('click', fitPeta);

  // Detail
  document.querySelectorAll('.tab-gambar button').forEach(b => b.addEventListener('click', () => tampilGambarDetail(b.dataset.gambar)));
  byId('btnDetailUnduh').addEventListener('click', unduhGambarDetail);
  byId('btnDetailBagikan').addEventListener('click', bagikanDetail);
  byId('btnDetailPeta').addEventListener('click', () => { const id = state.detail.rec && state.detail.rec.id; modalDetail.hide(); if (id) tampilkanDiPeta(id); });
  byId('btnDetailHapus').addEventListener('click', () => { const r = state.detail.rec; modalDetail.hide(); if (r) mintaHapus(r.id); });
  byId('modalDetail').addEventListener('hidden.bs.modal', () => {
    state.detail.blobUrl.forEach(u => URL.revokeObjectURL(u));
    state.detail = { rec: null, aktif: 'citra', url: {}, blobUrl: [] };
    byId('detailGambar').removeAttribute('src');
  });

  byId('btnKonfirmasiHapus').addEventListener('click', jalankanHapus);

  // Koneksi ke backend
  byId('btnAturKoneksi').addEventListener('click', () => bukaModalKoneksi(''));
  byId('formKoneksi').addEventListener('submit', simpanFormKoneksi);

  // Pengaturan
  byId('aturTema').addEventListener('change', (e) => { state.pengaturan.tema = e.target.checked ? 'dark' : 'light'; simpanPengaturan(); terapkanTema(state.pengaturan.tema); });
  byId('aturZoom').addEventListener('change', (e) => { state.pengaturan.zoom = e.target.value; simpanPengaturan(); gambarKotakCakupan(); });
  byId('aturResolusi').addEventListener('change', (e) => { state.pengaturan.resolusi = e.target.value; simpanPengaturan(); });
  byId('aturKualitas').addEventListener('change', (e) => { state.pengaturan.kualitas = e.target.value; simpanPengaturan(); });
  byId('aturAlamat').addEventListener('change', (e) => { state.pengaturan.alamat = e.target.checked; simpanPengaturan(); });
  byId('aturTeksTambahan').addEventListener('input', (e) => { state.pengaturan.teksTambahan = e.target.value.trim(); simpanPengaturan(); });
}

// ════════════════════════════════════════════════════════
// BAGIAN 3: NAVIGASI, TEMA, KONEKSI SERVER
// ════════════════════════════════════════════════════════

function navigateTo(sectionId) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  const target = byId('section-' + sectionId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === sectionId));
  const judul = { ambil: 'Ambil titik', riwayat: 'Riwayat titik', peta: 'Peta titik', pengaturan: 'Pengaturan' };
  byId('pageTitle').textContent = judul[sectionId] || '';
  window.scrollTo(0, 0);

  if (sectionId === 'peta') {
    if (!state.peta) initPeta();
    requestAnimationFrame(() => state.peta && state.peta.invalidateSize());
  }
  if (sectionId === 'ambil' && state.petaMini) requestAnimationFrame(() => state.petaMini.invalidateSize());
  if (sectionId === 'riwayat' && navigator.onLine) muatDaftar(false);
}

function terapkanTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  document.documentElement.setAttribute('data-bs-theme', tema);
  byId('btnTema').querySelector('i').className = tema === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tema === 'dark' ? '#0e1511' : '#2e7d4f');
}

function isiFormPengaturan() {
  const p = state.pengaturan;
  byId('aturTema').checked = p.tema === 'dark';
  byId('aturZoom').value = String(p.zoom);
  byId('aturResolusi').value = String(p.resolusi);
  byId('aturKualitas').value = String(p.kualitas);
  byId('aturAlamat').checked = !!p.alamat;
  byId('aturTeksTambahan').value = p.teksTambahan || '';
}

function updateIndikatorOnline() {
  const el = byId('indikatorOnline');
  const online = navigator.onLine;
  el.classList.toggle('offline', !online);
  el.classList.toggle('sinkron', online && state.sedangSinkron);
  el.querySelector('i').className = !online ? 'bi bi-cloud-slash' : (state.sedangSinkron ? 'bi bi-cloud-arrow-up' : 'bi bi-cloud-check');
  el.title = !online ? 'Offline — titik disimpan di HP' : (state.sedangSinkron ? 'Mengirim antrean...' : 'Terhubung');
}

// Fungsi panggil(), panggilDenganBatas(), adaServer() ada di js/api.js

async function muatInfoServer() {
  document.querySelectorAll('.link-sheet, .link-folder').forEach(a => a.classList.add('disabled'));
  try {
    state.info = await panggil('getInfoAplikasi');
    document.querySelectorAll('.link-sheet').forEach(a => { a.href = state.info.urlSpreadsheet; a.classList.remove('disabled'); });
    document.querySelectorAll('.link-folder').forEach(a => { a.href = state.info.urlFolder; a.classList.remove('disabled'); });
    byId('infoServer').innerHTML = '<i class="bi bi-check-circle-fill text-accent"></i> Terhubung. ' +
      state.info.jumlahTitik + ' titik tercatat di spreadsheet <b>DB GeoFoto Lahan</b>, gambar di folder <b>GeoFoto Lahan</b> (Drive).';
  } catch (e) {
    document.querySelectorAll('.link-sheet, .link-folder').forEach(a => a.classList.add('disabled'));
    byId('infoServer').innerHTML = '<i class="bi bi-exclamation-triangle-fill warna-antre"></i> Belum terhubung: ' + esc(e.message);
    cekGalatKoneksi(e);
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 4: GPS
// ════════════════════════════════════════════════════════

function mulaiGPS() {
  if (!('geolocation' in navigator)) {
    setStatusGPS('error', 'GPS tidak didukung');
    byId('gpsDms').textContent = 'Browser ini tidak mendukung lokasi. Coba buka dengan Google Chrome.';
    return;
  }
  navigator.geolocation.watchPosition(onPosisi, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

function onPosisi(pos) {
  const c = pos.coords;
  const pertama = !state.posisi;
  state.posisi = {
    lat: c.latitude, lng: c.longitude, akurasi: c.accuracy,
    altitude: (c.altitude === null || c.altitude === undefined) ? null : c.altitude,
    waktu: pos.timestamp || Date.now()
  };
  renderGPS();
  perbaruiLokasiSaya();
  if (!state.titik || state.titik.mode === 'gps') pindahTitik(state.posisi.lat, state.posisi.lng, 'gps', pertama);
  else renderTitik();
}

function onGpsError(err) {
  const pesan = {
    1: 'Izin lokasi ditolak. Buka pengaturan browser → Izin situs → Lokasi → Izinkan, lalu muat ulang. Titik masih bisa dipilih manual di peta.',
    2: 'Sinyal GPS tidak tersedia. Nyalakan GPS/Lokasi HP dan pindah ke area terbuka.',
    3: 'GPS lambat merespons. Masih terus mencoba...'
  }[err.code] || ('Kesalahan GPS: ' + err.message);
  if (err.code === 3 && state.posisi) return;
  setStatusGPS(err.code === 3 ? 'cari' : 'error', err.code === 1 ? 'Izin ditolak' : err.code === 3 ? 'Mencari sinyal...' : 'Tidak ada sinyal');
  byId('gpsDms').textContent = pesan;
  if (err.code === 1) showToast('Izin lokasi diperlukan', pesan, 'danger');
}

function kelasAkurasi(a) {
  if (a <= 10) return { status: 'baik', label: 'Akurasi baik' };
  if (a <= 30) return { status: 'sedang', label: 'Akurasi sedang' };
  return { status: 'lemah', label: 'Akurasi lemah' };
}

function renderGPS() {
  const p = state.posisi;
  if (!p) return;
  byId('gpsLat').textContent = p.lat.toFixed(6);
  byId('gpsLng').textContent = p.lng.toFixed(6);
  byId('gpsDms').textContent = keDMS(p.lat, 'lat') + '   ' + keDMS(p.lng, 'lng');
  byId('gpsAkurasi').textContent = '±' + Math.round(p.akurasi) + ' m';
  byId('gpsAlt').textContent = p.altitude === null ? '—' : Math.round(p.altitude) + ' m';
  const k = kelasAkurasi(p.akurasi);
  setStatusGPS(k.status, k.label);
  const bar = byId('gpsBar');
  bar.style.width = Math.max(8, Math.min(100, 100 - (p.akurasi - 5) * 2)) + '%';
  bar.className = 'gps-bar-isi ' + k.status;
  renderUmurGPS();
}

function renderUmurGPS() {
  const p = state.posisi;
  if (!p) return;
  const detik = Math.max(0, Math.round((Date.now() - p.waktu) / 1000));
  byId('gpsUmur').textContent = detik < 60 ? detik + ' dtk' : Math.floor(detik / 60) + ' mnt';
  if (detik > 90) { setStatusGPS('lama', 'Belum diperbarui'); byId('gpsBar').className = 'gps-bar-isi lama'; }
}

function setStatusGPS(status, label) {
  byId('gpsStatus').className = 'status-gps ' + status;
  byId('gpsStatusTeks').textContent = label;
}

/** Posisi segar (maks. 8 detik), jika gagal pakai posisi terakhir. */
function kunciLokasi() {
  // Posisi masih segar (≤5 detik) dan cukup akurat → pakai langsung, tanpa menunggu
  const p0 = state.posisi;
  if (p0 && Date.now() - p0.waktu <= 5000 && p0.akurasi <= 30) return Promise.resolve(Object.assign({}, p0));

  return new Promise((resolve) => {
    const cadangan = state.posisi;
    let selesai = false;
    const akhiri = (h) => { if (selesai) return; selesai = true; clearTimeout(tunda); resolve(h); };
    const tunda = setTimeout(() => akhiri(cadangan), 8000);
    if (!('geolocation' in navigator)) return akhiri(cadangan);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onPosisi(pos); akhiri(state.posisi); },
      () => akhiri(cadangan),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000 }
    );
  }).then((p) => {
    if (!p) throw new Error('Lokasi GPS belum didapat. Pastikan GPS aktif, atau pilih titik manual di peta.');
    return Object.assign({}, p);
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 5: PETA MINI & PEMILIHAN TITIK
// ════════════════════════════════════════════════════════

function lapisanSatelit() {
  return L.tileLayer(TILE_SATELIT, { maxNativeZoom: 18, maxZoom: 20, attribution: 'Citra &copy; Esri' });
}

function initPetaMini() {
  if (typeof L === 'undefined') {
    byId('petaMini').innerHTML = '<div class="peta-gagal">Peta tidak bisa dimuat (periksa internet).<br>Titik tetap memakai posisi GPS.</div>';
    return;
  }
  const m = L.map('petaMini', { zoomControl: true, attributionControl: true });
  lapisanSatelit().addTo(m);
  m.setView([-2.5, 118], 4);
  m.on('click', (e) => pindahTitik(e.latlng.lat, e.latlng.lng, 'peta', false));
  state.petaMini = m;
}

function pindahTitik(lat, lng, mode, pusatkan) {
  state.titik = { lat, lng, mode };
  const m = state.petaMini;
  if (m) {
    if (!state.pinMini) {
      state.pinMini = L.marker([lat, lng], {
        draggable: true, autoPan: true, zIndexOffset: 1000,
        icon: L.divIcon({ className: 'pin-titik-wrap', html: '<div class="pin-titik"></div>', iconSize: [36, 46], iconAnchor: [18, 40] })
      }).addTo(m);
      state.pinMini.on('dragend', () => { const p = state.pinMini.getLatLng(); pindahTitik(p.lat, p.lng, 'peta', false); });
    } else {
      state.pinMini.setLatLng([lat, lng]);
    }
    gambarKotakCakupan();
    if (pusatkan) m.setView([lat, lng], 17);
    else if (!m.getBounds().contains([lat, lng])) m.panTo([lat, lng]);
  }
  renderTitik();
}

function ikutiGPS() {
  if (!state.posisi) { showToast('GPS belum siap', 'Tunggu sampai koordinat GPS muncul.', 'warning'); return; }
  pindahTitik(state.posisi.lat, state.posisi.lng, 'gps', true);
}

/** Kotak putih putus-putus = area yang tertangkap citra satelit (640×640 px). */
function gambarKotakCakupan() {
  if (!state.petaMini || !state.titik) return;
  const t = state.titik;
  const setengah = 320 * meterPerPiksel(t.lat, Number(state.pengaturan.zoom));
  const dLat = setengah / 111320;
  const dLng = setengah / (111320 * Math.cos(t.lat * Math.PI / 180));
  const batas = [[t.lat - dLat, t.lng - dLng], [t.lat + dLat, t.lng + dLng]];
  if (!state.kotakMini) {
    state.kotakMini = L.rectangle(batas, { color: '#ffffff', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(state.petaMini);
  } else {
    state.kotakMini.setBounds(batas);
  }
}

function renderTitik() {
  const t = state.titik;
  if (!t) return;
  byId('teksTitik').textContent = t.lat.toFixed(6) + ', ' + t.lng.toFixed(6);
  const chip = byId('chipTitik');
  if (t.mode === 'gps') {
    chip.className = 'chip-titik gps';
    chip.innerHTML = '<i class="bi bi-crosshair"></i> <span>Mengikuti GPS</span>';
  } else {
    chip.className = 'chip-titik peta';
    const jarak = state.posisi ? ' · ' + formatJarak(jarakMeter(state.posisi, t)) + ' dari Anda' : '';
    chip.innerHTML = '<i class="bi bi-hand-index"></i> <span>Dipilih di peta' + esc(jarak) + '</span>';
  }
  byId('btnIkutiGps').disabled = t.mode === 'gps' || !state.posisi;
}

// ════════════════════════════════════════════════════════
// BAGIAN 6: FOTO LAPANGAN (kamera + watermark)
// ════════════════════════════════════════════════════════

function ambilFoto() {
  if (state.sedangProses) return;
  const input = byId('inputKamera');
  input.value = '';
  input.click();
}

async function onFotoDipilih(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type || 'image/')) { showToast('Bukan gambar', 'File yang dipilih bukan foto.', 'danger'); return; }

  const sekarang = Date.now();
  const waktu = (file.lastModified && Math.abs(sekarang - file.lastModified) < 10 * 60 * 1000) ? new Date(file.lastModified) : new Date(sekarang);

  state.sedangProses = true;
  tampilkanProses(true, 'Mengunci lokasi foto...');
  try {
    const posisi = await kunciLokasi();
    let alamat = '';
    if (state.pengaturan.alamat && navigator.onLine) {
      tampilkanProses(true, 'Mencari alamat...');
      try { const a = await panggilDenganBatas(6000, 'getAlamat', posisi.lat, posisi.lng); alamat = a ? a.lengkap : ''; } catch (err) { alamat = ''; }
    }
    tampilkanProses(true, 'Menempel watermark...');
    const hasil = await buatFotoWatermark(file, posisi, alamat, waktu, byId('inputKeterangan').value.trim());
    state.fotoDraft = {
      blob: hasil.blob, thumb: hasil.thumb, lebar: hasil.lebar, tinggi: hasil.tinggi,
      lat: posisi.lat, lng: posisi.lng, akurasi: posisi.akurasi, waktu: waktu.toISOString()
    };
    renderFotoDraft();
    if (posisi.akurasi > 30) showToast('Akurasi GPS lemah', 'Foto tetap dipakai (±' + Math.round(posisi.akurasi) + ' m).', 'warning');
  } catch (err) {
    showToast('Gagal memproses foto', err.message || String(err), 'danger');
  } finally {
    state.sedangProses = false;
    tampilkanProses(false);
    e.target.value = '';
  }
}

function renderFotoDraft() {
  const f = state.fotoDraft;
  byId('fotoKosong').classList.toggle('d-none', !!f);
  byId('fotoAda').classList.toggle('d-none', !f);
  if (!f) return;
  byId('fotoPratinjau').src = f.thumb;
  byId('fotoInfo').textContent = formatUkuran(f.blob.size) + ' · ' + f.lat.toFixed(5) + ', ' + f.lng.toFixed(5) + ' · ±' + Math.round(f.akurasi) + ' m';
}

async function buatFotoWatermark(file, p, alamat, waktu, keterangan) {
  const url = URL.createObjectURL(file);
  try {
    const img = await muatGambar(url);
    await muatFont();
    let w = img.naturalWidth, h = img.naturalHeight;
    const maks = Number(state.pengaturan.resolusi) || 2048;
    if (Math.max(w, h) > maks) { const r = maks / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const s = Math.max(0.6, Math.min(w, h) / 1000);
    let teksAkurasi = 'Akurasi ±' + Math.round(p.akurasi) + ' m';
    if (p.altitude !== null && p.altitude !== undefined) teksAkurasi += '   ·   Ketinggian ' + Math.round(p.altitude) + ' mdpl';
    const isi = [
      ['FOTO LAPANGAN', 22, 800, '#7fe0a6', 1],
      [formatWaktuPanjang(waktu), 34, 700, '#ffffff', 2],
      ['Lat ' + p.lat.toFixed(6) + '    Long ' + p.lng.toFixed(6), 31, 800, '#b8f3cd', 1],
      [keDMS(p.lat, 'lat') + '    ' + keDMS(p.lng, 'lng'), 24, 500, '#e7eee9', 1],
      [teksAkurasi, 24, 500, '#e7eee9', 1],
      [alamat, 24, 500, '#ffffff', 3],
      [keterangan ? 'Ket: ' + keterangan : '', 27, 700, '#ffe49a', 2],
      [state.pengaturan.teksTambahan, 22, 500, '#d3dbd6', 1]
    ];
    const baris = susunBaris(ctx, isi, w, s);
    const tinggi = tinggiPanel(baris, s);
    gambarPanel(ctx, baris, 0, h - tinggi, w, s, true);
    gambarLencana(ctx, w, s, 'GeoFoto Lahan');

    const blob = await canvasKeBlob(canvas, Number(state.pengaturan.kualitas) || 0.9);
    const thumb = buatThumb(canvas, 220);
    canvas.width = 0; canvas.height = 0;
    return { blob, thumb, lebar: w, tinggi: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 7: CITRA SATELIT + PANEL KETERANGAN
// ════════════════════════════════════════════════════════

/**
 * Gambar satelit 640 px diperbesar 2× (1280 px) supaya teks tajam,
 * lalu ditambah skala, arah utara, dan panel keterangan di BAWAH gambar
 * (tidak menutupi lahan).
 */
async function buatCitraWatermark(base64, mime, rec) {
  const img = await muatGambar('data:' + (mime || 'image/jpeg') + ';base64,' + base64);
  await muatFont();
  const faktor = 2;
  const W = img.naturalWidth * faktor, H = img.naturalHeight * faktor;
  const s = W / 1000;

  const alamat = rec.alamat && rec.alamat.lengkap ? rec.alamat.lengkap : '';
  const zoom = Number(rec.zoom) || 18;
  const mpp = meterPerPiksel(rec.lat, zoom);               // meter per piksel asli
  const cakupan = Math.round(mpp * img.naturalWidth);
  const sumber = rec.sumber === 'peta'
    ? 'Titik: dipilih di peta'
    : 'Titik: GPS' + (rec.akurasi !== null && rec.akurasi !== undefined ? ' (akurasi ±' + Math.round(rec.akurasi) + ' m)' : '');

  const ukur = document.createElement('canvas').getContext('2d');
  const isi = [
    ['CITRA SATELIT · TITIK LAHAN', 20, 800, '#7fe0a6', 1],
    [rec.keterangan, 30, 800, '#ffe49a', 2],
    [formatWaktuPanjang(new Date(rec.waktuIso)), 24, 700, '#ffffff', 2],
    ['Lat ' + rec.lat.toFixed(6) + '    Long ' + rec.lng.toFixed(6), 27, 800, '#b8f3cd', 1],
    [keDMS(rec.lat, 'lat') + '    ' + keDMS(rec.lng, 'lng'), 21, 500, '#e7eee9', 1],
    [sumber + '   ·   Zoom ' + zoom + '   ·   Cakupan ±' + cakupan + ' × ' + cakupan + ' m', 21, 500, '#e7eee9', 2],
    [alamat, 21, 500, '#ffffff', 3],
    [state.pengaturan.teksTambahan, 20, 500, '#d3dbd6', 1]
  ];
  const baris = susunBaris(ukur, isi, W, s);
  const tp = tinggiPanel(baris, s);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H + tp;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);

  ctx.fillStyle = '#121a15';
  ctx.fillRect(0, H, W, tp);
  gambarPanel(ctx, baris, 0, H, W, s, false);

  gambarSkala(ctx, 24 * s, H - 70 * s, mpp / faktor, s);
  gambarUtara(ctx, 50 * s, 58 * s, s);
  gambarLencana(ctx, W, s, 'Citra Satelit');

  const blob = await canvasKeBlob(canvas, 0.9);
  canvas.width = 0; canvas.height = 0;
  return blob;
}

/** Meter per piksel peta web (Web Mercator, tile 256 px). */
function meterPerPiksel(lat, zoom) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function gambarSkala(ctx, x, y, mppTampil, s) {
  const target = 220 * s * mppTampil;           // panjang maksimum dalam meter
  const pilihan = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  let meter = pilihan[0];
  pilihan.forEach(v => { if (v <= target) meter = v; });
  const px = meter / mppTampil;
  const tinggi = 10 * s;
  const label = meter >= 1000 ? (meter / 1000) + ' km' : meter + ' m';

  ctx.save();
  ctx.font = '700 ' + Math.round(20 * s) + 'px ' + FONT_WM;
  const lebarKotak = Math.max(px, ctx.measureText(label).width) + 24 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  kotakBulat(ctx, x, y - 32 * s, lebarKotak, 50 * s, 8 * s); ctx.fill();
  const bx = x + 12 * s, by = y + 4 * s;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx, by, px, tinggi);
  ctx.fillStyle = '#121a15';
  ctx.fillRect(bx + px / 2, by + 2 * s, px / 2 - 2 * s, tinggi - 4 * s);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  ctx.fillText(label, bx, by - 4 * s);
  ctx.restore();
}

function gambarUtara(ctx, cx, cy, s) {
  const r = 30 * s;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e5392f';
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.72); ctx.lineTo(cx + r * 0.3, cy + r * 0.05); ctx.lineTo(cx - r * 0.3, cy + r * 0.05); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.62); ctx.lineTo(cx + r * 0.3, cy + r * 0.05); ctx.lineTo(cx - r * 0.3, cy + r * 0.05); ctx.closePath(); ctx.fill();
  ctx.font = '800 ' + Math.round(16 * s) + 'px ' + FONT_WM;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('U', cx, cy + r + 4 * s);
  ctx.restore();
}

// ════════════════════════════════════════════════════════
// BAGIAN 8: ALAT GAMBAR BERSAMA (teks, panel, lencana)
// ════════════════════════════════════════════════════════

const FONT_WM = '"Plus Jakarta Sans", "Segoe UI", Roboto, Arial, sans-serif';
const JARAK_BARIS = 1.36;

async function muatFont() {
  try {
    await Promise.all([
      document.fonts.load('800 40px "Plus Jakarta Sans"'),
      document.fonts.load('700 40px "Plus Jakarta Sans"'),
      document.fonts.load('500 40px "Plus Jakarta Sans"')
    ]);
  } catch (e) { /* font cadangan dipakai */ }
}

/** isi: [teks, ukuran, tebal, warna, maksBaris] → baris siap gambar */
function susunBaris(ctx, isi, w, s) {
  const pad = Math.round(28 * s), bar = Math.max(3, Math.round(7 * s)), celah = Math.round(18 * s);
  const lebarTeks = w - pad * 2 - bar - celah;
  const baris = [];
  isi.forEach(([teks, ukuran, tebal, warna, maks]) => {
    if (!teks) return;
    const px = Math.round(ukuran * s);
    const font = tebal + ' ' + px + 'px ' + FONT_WM;
    ctx.font = font;
    bungkusTeks(ctx, teks, lebarTeks, maks).forEach(t => baris.push({ t, font, px, warna }));
  });
  return baris;
}

function tinggiPanel(baris, s) {
  const pad = Math.round(28 * s);
  return baris.reduce((a, b) => a + b.px * JARAK_BARIS, 0) + pad * 2 - (baris.length ? baris[baris.length - 1].px * (JARAK_BARIS - 1) : 0);
}

function gambarPanel(ctx, baris, x0, y0, w, s, transparan) {
  const pad = Math.round(28 * s), bar = Math.max(3, Math.round(7 * s)), celah = Math.round(18 * s);
  const tinggi = tinggiPanel(baris, s);
  ctx.save();
  if (transparan) {
    const fade = Math.round(70 * s);
    const g = ctx.createLinearGradient(0, y0 - fade, 0, y0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0 - fade, w, fade);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x0, y0, w, tinggi);
  }
  ctx.fillStyle = '#3fbf74';
  ctx.fillRect(x0 + pad, y0 + pad, bar, tinggi - pad * 2);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (transparan) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4 * s; ctx.shadowOffsetY = 1 * s; }
  let y = y0 + pad;
  const x = x0 + pad + bar + celah;
  baris.forEach(b => { ctx.font = b.font; ctx.fillStyle = b.warna; ctx.fillText(b.t, x, y); y += b.px * JARAK_BARIS; });
  ctx.restore();
}

function gambarLencana(ctx, w, s, label) {
  const pad = Math.round(28 * s);
  const fb = Math.round(22 * s);
  ctx.save();
  ctx.font = '700 ' + fb + 'px ' + FONT_WM;
  const lw = ctx.measureText(label).width;
  const bh = Math.round(fb * 1.9), bw = Math.round(lw + fb * 2.7);
  const bx = w - pad - bw, by = pad;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  kotakBulat(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
  const r = fb * 0.42, cx = bx + fb * 1.1, cy = by + bh / 2 - fb * 0.14;
  ctx.fillStyle = '#3fbf74';
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.lineTo(cx, cy + r * 1.65); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(label, bx + fb * 1.95, by + bh / 2 + fb * 0.04);
  ctx.restore();
}

function bungkusTeks(ctx, teks, maxW, maksBaris) {
  const kata = String(teks).split(/\s+/).filter(Boolean);
  const hasil = [];
  let baris = '';
  kata.forEach(k => {
    const coba = baris ? baris + ' ' + k : k;
    if (!baris || ctx.measureText(coba).width <= maxW) baris = coba;
    else { hasil.push(baris); baris = k; }
  });
  if (baris) hasil.push(baris);
  if (hasil.length > maksBaris) {
    const potong = hasil.slice(0, maksBaris);
    let akhir = potong[maksBaris - 1];
    while (akhir.length > 1 && ctx.measureText(akhir + '…').width > maxW) akhir = akhir.slice(0, -1);
    potong[maksBaris - 1] = akhir.trim() + '…';
    return potong;
  }
  return hasil;
}

function kotakBulat(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function muatGambar(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibaca.'));
    img.src = src;
  });
}

function canvasKeBlob(canvas, kualitas) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b)
    : rej(new Error('Gagal membuat file gambar (memori HP penuh?). Kecilkan ukuran foto di Pengaturan.')), 'image/jpeg', kualitas));
}

function buatThumb(sumber, maks) {
  const r = Math.min(1, maks / Math.max(sumber.width, sumber.height));
  const c = document.createElement('canvas');
  c.width = Math.round(sumber.width * r); c.height = Math.round(sumber.height * r);
  c.getContext('2d').drawImage(sumber, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function thumbDariBlob(blob, maks) {
  const url = URL.createObjectURL(blob);
  try { return buatThumb(await muatGambar(url), maks); } finally { URL.revokeObjectURL(url); }
}

function blobKeBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('Gagal membaca file.'));
    fr.readAsDataURL(blob);
  });
}

function tampilkanProses(tampil, teks) {
  if (teks) byId('teksProses').textContent = teks;
  byId('overlayProses').classList.toggle('show', !!tampil);
}

// ════════════════════════════════════════════════════════
// BAGIAN 9: SIMPAN TITIK & ANTREAN OFFLINE
// ════════════════════════════════════════════════════════

async function simpanTitikBaru() {
  if (state.sedangProses) return;
  if (!state.titik) { showToast('Titik belum ada', 'Tunggu GPS atau ketuk peta untuk memilih titik.', 'warning'); return; }

  state.sedangProses = true;
  tampilkanProses(true, 'Mengunci titik...');
  let rec = null;
  try {
    let akurasi = null, altitude = null;
    if (state.titik.mode === 'gps') {
      const p = await kunciLokasi();
      pindahTitik(p.lat, p.lng, 'gps', false);
      akurasi = p.akurasi; altitude = p.altitude;
    }
    const t = state.titik;
    const waktu = new Date();
    const f = state.fotoDraft;

    rec = {
      id: 'T' + stempel(waktu) + '_' + Math.random().toString(36).slice(2, 6),
      waktuIso: waktu.toISOString(),
      waktu: formatWaktuIso(waktu),
      lat: t.lat, lng: t.lng, akurasi, altitude,
      sumber: t.mode,
      keterangan: byId('inputKeterangan').value.trim(),
      zoom: Number(state.pengaturan.zoom) || 18,
      foto: f ? { blob: f.blob, lat: f.lat, lng: f.lng, akurasi: f.akurasi } : null,
      citraBlob: null,
      alamat: null,
      thumb: f ? f.thumb : '',
      status: 'antre',
      pesan: ''
    };

    // Simpan dulu di HP agar tidak hilang, apa pun yang terjadi setelahnya
    await dbSimpan('antrean', rec);
    state.antrean = await dbSemua('antrean');
    state.fotoDraft = null; renderFotoDraft();
    if (t.mode === 'peta' && state.posisi) ikutiGPS();

    const hasil = await kirimSatu(rec, true);
    tampilkanHasil(hasil, rec);
    showToast('Titik tersimpan', 'Citra satelit' + (rec.foto ? ' & foto lapangan' : '') + ' masuk ke Drive, data tercatat di Sheets.', 'success');
  } catch (err) {
    cekGalatKoneksi(err);
    if (rec) {
      showToast('Tersimpan di HP dulu', 'Belum terkirim: ' + err.message + '. Akan dikirim otomatis saat ada internet.', 'warning');
    } else {
      showToast('Gagal menyimpan', err.message, 'danger');
    }
  } finally {
    state.sedangProses = false;
    tampilkanProses(false);
    state.antrean = await dbSemua('antrean');
    renderSemua();
  }
}

/** Kirim satu titik dari antrean: ambil citra (bila belum) → unggah → hapus dari antrean. */
async function kirimSatu(rec, tampil) {
  const langkah = (t) => { if (tampil) tampilkanProses(true, t); };
  try {
    if (!navigator.onLine) throw new Error('tidak ada internet');

    if (!rec.citraBlob) {
      langkah('Mengambil citra satelit...');
      const c = await panggil('ambilCitraSatelit', rec.lat, rec.lng, rec.zoom);
      rec.alamat = c.alamat || null;
      rec.zoom = c.zoom || rec.zoom;
      langkah('Menyusun citra & keterangan...');
      rec.citraBlob = await buatCitraWatermark(c.base64, c.mime, rec);
      if (!rec.thumb) rec.thumb = await thumbDariBlob(rec.citraBlob, 220);
      await dbSimpan('antrean', rec);
    }

    langkah('Mengunggah ke Drive & Sheets...');
    const data = {
      id: rec.id, waktu: rec.waktu, waktuIso: rec.waktuIso,
      lat: rec.lat, lng: rec.lng, akurasi: rec.akurasi, altitude: rec.altitude,
      sumber: rec.sumber, keterangan: rec.keterangan, zoom: rec.zoom, alamat: rec.alamat,
      namaDasar: 'Titik_' + stempel(new Date(rec.waktuIso)),
      fotoLat: rec.foto ? rec.foto.lat : null, fotoLng: rec.foto ? rec.foto.lng : null,
      thumb: rec.thumb,
      citraBase64: await blobKeBase64(rec.citraBlob),
      fotoBase64: rec.foto ? await blobKeBase64(rec.foto.blob) : ''
    };
    const hasil = await panggil('simpanTitik', data);
    await dbHapus('antrean', rec.id);

    // Masukkan ke daftar lokal tanpa menunggu muat ulang
    state.daftar = [hasil].concat(state.daftar.filter(d => d.id !== hasil.id));
    await dbSimpan('cache', { key: 'daftar', data: state.daftar });
    return hasil;
  } catch (err) {
    rec.status = 'gagal';
    rec.pesan = err.message;
    try { await dbSimpan('antrean', rec); } catch (e) { /* abaikan */ }
    throw err;
  }
}

async function prosesAntrean(manual) {
  if (state.sedangSinkron) return;
  const daftar = await dbSemua('antrean');
  if (!daftar.length) { if (manual) showToast('Antrean kosong', 'Semua titik sudah terkirim.', 'info'); return; }
  if (!navigator.onLine) { if (manual) showToast('Masih offline', 'Titik tetap aman di HP.', 'warning'); return; }

  state.sedangSinkron = true;
  updateIndikatorOnline();
  if (manual) tampilkanProses(true, 'Mengirim ' + daftar.length + ' titik...');
  let berhasil = 0, gagal = 0, pesan = '', galatTerakhir = null;
  for (const rec of daftar.sort((a, b) => a.waktuIso.localeCompare(b.waktuIso))) {
    try { await kirimSatu(rec, false); berhasil++; }
    catch (e) {
      gagal++; pesan = e.message; galatTerakhir = e;
      if (e.kode === 'KUNCI_SALAH' || e.kode === 'BELUM_TERHUBUNG' || e.kode === 'BUKAN_JSON') break; // percuma lanjut
    }
    if (manual) tampilkanProses(true, 'Terkirim ' + berhasil + ' dari ' + daftar.length + '...');
  }
  state.sedangSinkron = false;
  if (manual) tampilkanProses(false);
  updateIndikatorOnline();
  state.antrean = await dbSemua('antrean');
  renderSemua();
  if (berhasil) showToast('Antrean terkirim', berhasil + ' titik masuk ke Drive & Sheets.' + (gagal ? ' ' + gagal + ' masih gagal.' : ''), gagal ? 'warning' : 'success');
  else if (manual && gagal) showToast('Belum bisa mengirim', pesan, 'danger');
  if (galatTerakhir) cekGalatKoneksi(galatTerakhir);
}

function tampilkanHasil(hasil, rec) {
  state.terakhir = hasil;
  byId('kartuHasil').classList.remove('d-none');
  const img = byId('hasilGambar');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const url = rec && rec.citraBlob ? URL.createObjectURL(rec.citraBlob) : '';
  img.dataset.url = url;
  img.src = url || hasil.thumb;
  byId('hasilInfo').innerHTML = '<b>' + esc(hasil.keterangan || 'Titik lahan') + '</b> · ' + esc(hasil.waktu) +
    '<br>' + esc(hasil.lat.toFixed(6) + ', ' + hasil.lng.toFixed(6)) + ' · ' + esc(hasil.sumber) +
    (hasil.alamat ? '<br>' + esc(hasil.alamat) : '');
}

async function muatDaftar(manual) {
  if (!adaServer()) { if (manual) bukaModalKoneksi(''); return; }
  if (!navigator.onLine) { if (manual) showToast('Offline', 'Menampilkan data terakhir yang tersimpan di HP.', 'warning'); return; }
  try {
    const data = await panggil('getDaftarTitik');
    state.daftar = data || [];
    await dbSimpan('cache', { key: 'daftar', data: state.daftar });
    renderSemua();
    if (manual) showToast('Diperbarui', state.daftar.length + ' titik dimuat dari spreadsheet.', 'success');
  } catch (e) {
    if (manual) showToast('Gagal memuat', e.message, 'danger');
    cekGalatKoneksi(e);
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 10: DATABASE HP (IndexedDB)
// ════════════════════════════════════════════════════════

function bukaDB() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      if (!window.indexedDB) return reject(new Error('IndexedDB tidak tersedia'));
      req = indexedDB.open('geofoto-lahan-v2', 1);
    } catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('antrean')) db.createObjectStore('antrean', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka database'));
    req.onblocked = () => reject(new Error('Database terblokir'));
  });
}

function dbJalankan(store, mode, aksi) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(store, mode);
    const req = aksi(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || new Error('Gagal menyimpan di HP'));
    tx.onabort = () => reject(tx.error || new Error('Penyimpanan HP penuh'));
  });
}
async function dbSimpan(store, obj) {
  if (!state.db) { state.memori[store][obj.id || obj.key] = obj; return; }
  await dbJalankan(store, 'readwrite', s => s.put(obj));
}
async function dbAmbil(store, kunci) {
  if (!state.db) return state.memori[store][kunci] || null;
  return (await dbJalankan(store, 'readonly', s => s.get(kunci))) || null;
}
async function dbSemua(store) {
  if (!state.db) return Object.values(state.memori[store]);
  return (await dbJalankan(store, 'readonly', s => s.getAll())) || [];
}
async function dbHapus(store, kunci) {
  if (!state.db) { delete state.memori[store][kunci]; return; }
  await dbJalankan(store, 'readwrite', s => s.delete(kunci));
}

// ════════════════════════════════════════════════════════
// BAGIAN 11: RIWAYAT & DETAIL
// ════════════════════════════════════════════════════════

/** Gabungan: antrean (belum terkirim) di atas, lalu data dari Sheets. */
function semuaTitik() {
  const antre = state.antrean.slice().sort((a, b) => b.waktuIso.localeCompare(a.waktuIso))
    .map(r => Object.assign({}, r, { antre: true }));
  return antre.concat(state.daftar);
}
function cariTitik(id) { return semuaTitik().find(r => r.id === id) || null; }

function renderSemua() {
  renderRiwayat();
  if (state.peta) renderTitikPeta(false);
}

function renderRiwayat() {
  const list = semuaTitik();
  const jmlFoto = list.filter(r => r.antre ? !!r.foto : !!r.fotoId).length;
  byId('statTotal').textContent = list.length;
  byId('statFoto').textContent = jmlFoto;
  byId('statAntre').textContent = state.antrean.length;
  byId('kartuAntre').classList.toggle('d-none', !state.antrean.length);
  byId('teksAntre').textContent = state.antrean.length + ' titik belum terkirim';

  const badge = byId('badgeRiwayat');
  badge.textContent = list.length > 99 ? '99+' : list.length;
  badge.classList.toggle('d-none', !list.length);

  const wadah = byId('daftarRiwayat');
  if (!list.length) {
    wadah.innerHTML = '<div class="kosong"><i class="bi bi-pin-map"></i>Belum ada titik.<br>Simpan titik pertama dari tab Ambil.</div>';
    return;
  }
  wadah.innerHTML = list.map(r => {
    const adaFoto = r.antre ? !!r.foto : !!r.fotoId;
    return `
    <button type="button" class="kartu-foto" data-id="${esc(r.id)}">
      ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy">` : '<div class="thumb-kosong"><i class="bi bi-globe-asia-australia"></i></div>'}
      ${r.antre ? `<span class="lencana-status ${r.status === 'gagal' ? 'gagal' : ''}">${r.status === 'gagal' ? 'Gagal kirim' : 'Menunggu'}</span>` : ''}
      ${adaFoto ? '<span class="lencana-foto" title="Ada foto lapangan"><i class="bi bi-camera-fill"></i></span>' : ''}
      <div class="kartu-info">
        <div class="kartu-waktu">${esc(r.waktu)}</div>
        <div class="kartu-koordinat">${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>
        ${r.keterangan ? `<div class="kartu-ket">${esc(r.keterangan)}</div>` : ''}
      </div>
    </button>`;
  }).join('');
}

function bukaDetail(id) {
  const r = cariTitik(id);
  if (!r) return;
  state.detail = { rec: r, aktif: 'citra', url: {}, blobUrl: [] };
  byId('detailJudul').textContent = r.keterangan || ('Titik ' + r.waktu);
  byId('detailMaps').href = linkMaps(r);

  const adaFoto = r.antre ? !!r.foto : !!r.fotoId;
  const adaCitra = r.antre ? !!r.citraBlob : !!r.citraId;
  byId('tabFoto').disabled = !adaFoto;
  document.querySelector('.tab-gambar [data-gambar="citra"]').disabled = !adaCitra;

  if (r.antre) {
    if (r.citraBlob) { const u = URL.createObjectURL(r.citraBlob); state.detail.url.citra = u; state.detail.blobUrl.push(u); }
    if (r.foto) { const u = URL.createObjectURL(r.foto.blob); state.detail.url.foto = u; state.detail.blobUrl.push(u); }
  }

  const info = [
    ['Waktu', r.waktu],
    ['Koordinat', r.lat.toFixed(6) + ', ' + r.lng.toFixed(6)],
    ['DMS', keDMS(r.lat, 'lat') + '  ' + keDMS(r.lng, 'lng')],
    ['Sumber titik', r.antre ? (r.sumber === 'peta' ? 'Dipilih di peta' : 'GPS') : r.sumber],
    ['Akurasi', r.akurasi === null || r.akurasi === undefined ? '—' : '±' + Math.round(r.akurasi) + ' m'],
    ['Alamat', r.antre ? (r.alamat && r.alamat.lengkap) || '—' : (r.alamat || '—')],
    ['Keterangan', r.keterangan || '—'],
    ['Status', r.antre ? (r.status === 'gagal' ? 'Belum terkirim — ' + r.pesan : 'Menunggu dikirim') : 'Tersimpan di Drive & Sheets']
  ];
  byId('detailInfo').innerHTML = info.map(([k, v]) =>
    `<div class="baris"><div class="kunci">${esc(k)}</div><div class="nilai">${esc(v)}</div></div>`).join('');

  modalDetail.show();
  tampilGambarDetail(adaCitra ? 'citra' : (adaFoto ? 'foto' : 'citra'));
}

async function tampilGambarDetail(jenis) {
  const d = state.detail;
  const r = d.rec;
  if (!r) return;
  d.aktif = jenis;
  document.querySelectorAll('.tab-gambar button').forEach(b => b.classList.toggle('aktif', b.dataset.gambar === jenis));

  const drive = byId('detailDrive');
  const urlDrive = r.antre ? '' : (jenis === 'foto' ? r.fotoUrl : r.citraUrl);
  drive.href = urlDrive || '#';
  drive.classList.toggle('disabled', !urlDrive);

  const img = byId('detailGambar'), muat = byId('detailMemuat');
  if (d.url[jenis]) { img.src = d.url[jenis]; img.classList.remove('d-none'); muat.classList.add('d-none'); return; }

  img.classList.add('d-none'); muat.classList.remove('d-none');
  muat.innerHTML = '<div class="spinner-border"></div><div class="mt-2 small">Memuat gambar dari Drive...</div>';
  const fileId = r.antre ? '' : (jenis === 'foto' ? r.fotoId : r.citraId);
  if (!fileId) {
    muat.innerHTML = '<i class="bi bi-hourglass-split fs-2"></i><div class="mt-2 small">Citra satelit diambil saat titik dikirim (butuh internet).</div>';
    return;
  }
  try {
    if (!state.cacheGambar[fileId]) {
      const g = await panggil('getGambar', fileId);
      state.cacheGambar[fileId] = 'data:' + g.mime + ';base64,' + g.base64;
    }
    if (state.detail.rec !== r) return; // modal sudah ditutup/berganti
    d.url[jenis] = state.cacheGambar[fileId];
    if (d.aktif === jenis) { img.src = d.url[jenis]; img.classList.remove('d-none'); muat.classList.add('d-none'); }
  } catch (e) {
    muat.innerHTML = '<i class="bi bi-exclamation-triangle fs-2"></i><div class="mt-2 small">' + esc(e.message) + '</div>';
  }
}

async function blobGambarDetail() {
  const d = state.detail, r = d.rec;
  if (!r) return null;
  if (r.antre) return d.aktif === 'foto' ? (r.foto && r.foto.blob) : r.citraBlob;
  const url = d.url[d.aktif];
  if (!url) return null;
  return (await fetch(url)).blob();
}

async function unduhGambarDetail() {
  const r = state.detail.rec;
  const blob = await blobGambarDetail();
  if (!blob) { showToast('Gambar belum siap', 'Tunggu sampai gambar selesai dimuat.', 'warning'); return; }
  const nama = 'Titik_' + stempel(new Date(r.waktuIso || Date.now())) + (state.detail.aktif === 'foto' ? '_lapangan.jpg' : '_satelit.jpg');
  unduhBlob(blob, nama);
  showToast('Mengunduh', nama + ' — cek folder Download.', 'info');
}

async function bagikanDetail() {
  const r = state.detail.rec;
  if (!r) return;
  const teks = [r.keterangan || 'Titik lahan', r.waktu, 'Koordinat: ' + r.lat.toFixed(6) + ', ' + r.lng.toFixed(6), linkMaps(r)].join('\n');
  try {
    const blob = await blobGambarDetail();
    if (blob && navigator.canShare) {
      const file = new File([blob], 'titik_lahan.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: teks }); return; }
    }
    if (navigator.share) { await navigator.share({ title: 'Titik lahan', text: teks }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const ok = await salinTeks(teks);
  showToast(ok ? 'Teks disalin' : 'Tidak bisa berbagi',
    ok ? 'Koordinat & link Google Maps disalin — tempel di WhatsApp. Gambar bisa diunduh atau dibagikan dari Drive.' : 'Bagikan lewat Drive.', ok ? 'info' : 'warning');
}

function mintaHapus(id) {
  const r = cariTitik(id);
  if (!r) return;
  state.hapusTarget = r;
  byId('teksHapus').textContent = r.antre
    ? 'Hapus titik yang belum terkirim ini dari HP?'
    : 'Hapus titik ini? Baris di spreadsheet dihapus dan gambarnya dipindah ke Sampah Drive.';
  modalHapus.show();
}

async function jalankanHapus() {
  const r = state.hapusTarget;
  if (!r) return;
  const tombol = byId('btnKonfirmasiHapus');
  tombol.disabled = true;
  try {
    if (r.antre) {
      await dbHapus('antrean', r.id);
      state.antrean = await dbSemua('antrean');
    } else {
      await panggil('hapusTitik', r.id);
      state.daftar = state.daftar.filter(d => d.id !== r.id);
      await dbSimpan('cache', { key: 'daftar', data: state.daftar });
    }
    if (state.terakhir && state.terakhir.id === r.id) { state.terakhir = null; byId('kartuHasil').classList.add('d-none'); }
    modalHapus.hide();
    renderSemua();
    showToast('Terhapus', 'Titik dihapus.', 'success');
  } catch (e) {
    modalHapus.hide();
    showToast('Gagal menghapus', e.message, 'danger');
  } finally {
    tombol.disabled = false;
    state.hapusTarget = null;
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 12: PETA SEMUA TITIK
// ════════════════════════════════════════════════════════

function initPeta() {
  if (state.peta) return;
  if (typeof L === 'undefined') { showToast('Peta tidak bisa dimuat', 'Periksa koneksi internet, lalu muat ulang.', 'danger'); return; }
  const satelit = lapisanSatelit();
  const jalan = L.tileLayer(TILE_JALAN, { maxNativeZoom: 19, maxZoom: 20, attribution: '&copy; OpenStreetMap' });
  state.peta = L.map('peta', { layers: [satelit] });
  L.control.layers({ 'Satelit': satelit, 'Peta jalan': jalan }, null, { position: 'topright' }).addTo(state.peta);
  L.control.scale({ imperial: false }).addTo(state.peta);
  state.layerTitik = L.featureGroup().addTo(state.peta);
  state.peta.setView([-2.5, 118], 5);
  renderTitikPeta(true);
  perbaruiLokasiSaya();
}

function renderTitikPeta(sesuaikan) {
  if (!state.peta) return;
  state.layerTitik.clearLayers();
  state.markerById = {};
  semuaTitik().forEach(r => {
    const isi = r.thumb ? '<img src="' + esc(r.thumb) + '" alt="">' : '<i class="bi bi-geo-alt-fill"></i>';
    const ikon = L.divIcon({
      className: 'pin-foto-wrap',
      html: '<div class="pin-foto' + (r.antre ? ' antre' : '') + '">' + isi + '</div><span class="pin-ekor"></span>',
      iconSize: [44, 54], iconAnchor: [22, 54], popupAnchor: [0, -50]
    });
    state.markerById[r.id] = L.marker([r.lat, r.lng], { icon: ikon, title: r.keterangan || r.waktu })
      .bindPopup(htmlPopup(r), { maxWidth: 240 }).addTo(state.layerTitik);
  });
  if (sesuaikan) fitPeta();
}

function htmlPopup(r) {
  return '<div class="popup-foto">' +
    (r.thumb ? '<img src="' + esc(r.thumb) + '" alt="">' : '') +
    '<div class="p-waktu">' + esc(r.keterangan || 'Titik lahan') + '</div>' +
    '<div class="p-koor">' + esc(r.waktu) + '</div>' +
    '<div class="p-koor">' + r.lat.toFixed(6) + ', ' + r.lng.toFixed(6) + (r.antre ? ' · <b>belum terkirim</b>' : '') + '</div>' +
    '<div class="p-aksi">' +
      '<a href="' + esc(linkMaps(r)) + '" target="_blank" rel="noopener">Google Maps</a>' +
      '<button type="button" onclick="bukaDetail(\'' + esc(r.id) + '\')">Detail</button>' +
    '</div></div>';
}

function fitPeta() {
  if (!state.peta) return;
  if (state.layerTitik.getLayers().length) state.peta.fitBounds(state.layerTitik.getBounds(), { padding: [50, 50], maxZoom: 18 });
  else if (state.posisi) state.peta.setView([state.posisi.lat, state.posisi.lng], 17);
}

/** Titik biru "lokasi saya" di peta mini dan peta besar. */
function perbaruiLokasiSaya() {
  if (!state.posisi || typeof L === 'undefined') return;
  const ll = [state.posisi.lat, state.posisi.lng];
  [['mini', state.petaMini], ['besar', state.peta]].forEach(([kunci, peta]) => {
    if (!peta) return;
    let m = state.lokasiSaya[kunci];
    if (!m) {
      m = {
        lingkaran: L.circle(ll, { radius: state.posisi.akurasi, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(peta),
        titik: L.circleMarker(ll, { radius: 7, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(peta)
      };
      state.lokasiSaya[kunci] = m;
    } else {
      m.titik.setLatLng(ll);
      m.lingkaran.setLatLng(ll).setRadius(state.posisi.akurasi);
    }
  });
}

function tampilkanDiPeta(id) {
  navigateTo('peta');
  const r = cariTitik(id);
  if (!state.peta || !r) return;
  setTimeout(() => {
    state.peta.invalidateSize();
    state.peta.setView([r.lat, r.lng], 18);
    const m = state.markerById[id];
    if (m) m.openPopup();
  }, 120);
}

function eksporKML() {
  const list = semuaTitik();
  if (!list.length) { showToast('Belum ada data', 'Simpan titik terlebih dahulu.', 'warning'); return; }
  const x = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titik = list.slice().reverse().map((r, i) => {
    const alamat = r.antre ? (r.alamat && r.alamat.lengkap) : r.alamat;
    const desk = ['Waktu: ' + r.waktu, alamat ? 'Alamat: ' + alamat : '', r.citraUrl ? 'Citra: ' + r.citraUrl : '', r.fotoUrl ? 'Foto: ' + r.fotoUrl : '']
      .filter(Boolean).join('\n');
    return '  <Placemark>\n    <name>' + x(r.keterangan || ('Titik ' + (i + 1))) + '</name>\n' +
      '    <description>' + x(desk) + '</description>\n' +
      '    <Point><coordinates>' + r.lng.toFixed(7) + ',' + r.lat.toFixed(7) + '</coordinates></Point>\n  </Placemark>';
  }).join('\n');
  // '<' + '?xml' ditulis terpisah agar tidak dibaca sebagai scriptlet GAS
  const kml = '<' + '?xml version="1.0" encoding="UTF-8"?' + '>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n' +
    '  <name>Titik Lahan</name>\n' + titik + '\n</Document>\n</kml>\n';
  unduhBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'Titik_Lahan_' + stempel(new Date()) + '.kml');
  showToast('KML diunduh', 'Buka dengan Google Earth atau impor ke Google My Maps.', 'success');
}

// ════════════════════════════════════════════════════════
// BAGIAN 13: UTILITAS
// ════════════════════════════════════════════════════════

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pad2 = (n) => String(n).padStart(2, '0');

function zonaWaktu(d) {
  const off = -d.getTimezoneOffset() / 60;
  if (off === 7) return 'WIB';
  if (off === 8) return 'WITA';
  if (off === 9) return 'WIT';
  return 'GMT' + (off >= 0 ? '+' : '') + off;
}
function jam(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function formatWaktuPanjang(d) {
  return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + jam(d) + ' ' + zonaWaktu(d);
}
function formatWaktuIso(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + jam(d) + ' ' + zonaWaktu(d);
}
function stempel(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function keDMS(nilai, jenis) {
  const arah = jenis === 'lat' ? (nilai >= 0 ? 'LU' : 'LS') : (nilai >= 0 ? 'BT' : 'BB');
  const abs = Math.abs(nilai);
  let d = Math.floor(abs);
  const mDes = (abs - d) * 60;
  let m = Math.floor(mDes);
  let s = (mDes - m) * 60;
  if (s >= 59.995) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return d + '°' + pad2(m) + "'" + s.toFixed(2).padStart(5, '0') + '" ' + arah;
}

function jarakMeter(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function formatJarak(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2).replace('.', ',') + ' km'; }

function linkMaps(p) { return 'https://www.google.com/maps/search/?api=1&query=' + p.lat.toFixed(7) + ',' + p.lng.toFixed(7); }

function formatUkuran(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unduhBlob(blob, nama) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nama; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function salinTeks(teks) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(teks); return true; } } catch (e) { /* lanjut */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = teks; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  } catch (e) { return false; }
}

function showToast(judul, pesan, tipe) {
  tipe = tipe || 'info';
  const ikon = { success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', danger: 'bi-x-octagon-fill', info: 'bi-info-circle-fill' };
  byId('appToast').className = 'toast t-' + tipe;
  byId('toastIkon').className = 'bi ' + (ikon[tipe] || ikon.info);
  byId('toastTitle').textContent = judul;
  byId('toastBody').textContent = pesan;
  if (toastApp) toastApp.show();
}

// ════════════════════════════════════════════════════════
// BAGIAN 14: KONEKSI BACKEND & MODE OFFLINE (PWA)
// ════════════════════════════════════════════════════════

function bukaModalKoneksi(pesan) {
  byId('inputGasUrl').value = ambilUrlApi();
  byId('inputKunci').value = ambilKunciAkses();
  const el = byId('pesanKoneksi');
  el.className = 'small mt-2 ' + (pesan ? 'text-secondary-app' : '');
  el.textContent = pesan || '';
  modalKoneksi.show();
}

/** Tampilkan form koneksi bila galat disebabkan URL/kunci. */
function cekGalatKoneksi(err) {
  if (!err || !err.kode) return;
  if (err.kode === 'KUNCI_SALAH') bukaModalKoneksi('Kunci akses ditolak server. Periksa lagi kunci di Execution Log Apps Script.');
  else if (err.kode === 'BELUM_TERHUBUNG') bukaModalKoneksi('Isi URL API dan kunci akses terlebih dahulu.');
  else if (err.kode === 'BUKAN_JSON') bukaModalKoneksi(err.message);
}

async function simpanFormKoneksi(e) {
  e.preventDefault();
  const url = byId('inputGasUrl').value.trim();
  const kunci = byId('inputKunci').value.trim().toUpperCase();
  const pesan = byId('pesanKoneksi');
  if (!/^https:\/\/script\.google\.com\/(macros|a\/macros\/[^\/]+)\/s\/[\w-]+\/exec\/?$/.test(url)) {
    pesan.className = 'small mt-2 text-danger';
    pesan.textContent = 'URL harus berbentuk https://script.google.com/macros/s/.../exec';
    return;
  }
  if (kunci.length < 4) {
    pesan.className = 'small mt-2 text-danger';
    pesan.textContent = 'Kunci akses belum diisi.';
    return;
  }
  const tombol = byId('btnSimpanKoneksi');
  const labelAsli = tombol.innerHTML;
  tombol.disabled = true;
  tombol.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menguji...';
  const lamaUrl = ambilUrlApi(), lamaKunci = ambilKunciAkses();
  simpanKoneksi(url, kunci);
  try {
    await panggilDenganBatas(20000, 'getInfoAplikasi');
    modalKoneksi.hide();
    showToast('Terhubung', 'Aplikasi tersambung ke Google Drive & Sheets Anda.', 'success');
    muatInfoServer();
    muatDaftar(false);
    prosesAntrean(false);
  } catch (err) {
    simpanKoneksi(lamaUrl, lamaKunci); // kembalikan pengaturan lama bila gagal
    pesan.className = 'small mt-2 text-danger';
    pesan.textContent = 'Gagal: ' + err.message;
  } finally {
    tombol.disabled = false;
    tombol.innerHTML = labelAsli;
  }
}

/** Service worker: aplikasi tetap bisa dibuka tanpa sinyal setelah kunjungan pertama. */
function daftarkanServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan: aplikasi tetap jalan online */ });
}

// ── Mulai aplikasi (diletakkan paling akhir agar semua konstanta sudah siap) ──
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();
