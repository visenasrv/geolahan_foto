/**
 * ============================================================
 * GeoFoto Lahan — Koneksi ke backend Google Apps Script
 * ------------------------------------------------------------
 * Semua permintaan: POST ke URL /exec, body JSON dikirim sebagai
 * text/plain (agar tidak memicu CORS preflight yang ditolak GAS).
 *   { action: 'namaFungsi', args: [...], kunci: '...' }
 * Balasan: { success, data, message, kode? }
 * ============================================================
 */

const KUNCI_SIMPAN_URL = 'geofoto_gas_url';
const KUNCI_SIMPAN_AKSES = 'geofoto_kunci_akses';

/** URL API: yang disimpan di HP didahulukan, lalu GAS_URL dari config.js. */
function ambilUrlApi() {
  let tersimpan = '';
  try { tersimpan = localStorage.getItem(KUNCI_SIMPAN_URL) || ''; } catch (e) { /* abaikan */ }
  return (tersimpan || (typeof GAS_URL !== 'undefined' ? GAS_URL : '') || '').trim();
}
function ambilKunciAkses() {
  try { return (localStorage.getItem(KUNCI_SIMPAN_AKSES) || '').trim(); } catch (e) { return ''; }
}
function simpanKoneksi(url, kunci) {
  try {
    localStorage.setItem(KUNCI_SIMPAN_URL, url.trim());
    localStorage.setItem(KUNCI_SIMPAN_AKSES, kunci.trim().toUpperCase());
  } catch (e) { /* abaikan */ }
}

/** Sudah ada URL & kunci? */
const adaServer = () => !!ambilUrlApi() && !!ambilKunciAkses();

/** Galat khusus agar aplikasi bisa membedakan jenis kegagalan. */
class GalatApi extends Error {
  constructor(pesan, kode) { super(pesan); this.kode = kode || ''; }
}

/**
 * Panggil fungsi backend. Menolak (reject) jika success=false.
 * @param {string} namaFungsi  nama aksi di Kode.gs (mis. 'simpanTitik')
 * @param {...*}   args        argumen fungsi
 */
async function panggil(namaFungsi, ...args) {
  return panggilDenganOpsi({}, namaFungsi, ...args);
}

/** Sama seperti panggil(), tetapi menyerah setelah batas waktu (ms). */
async function panggilDenganBatas(ms, namaFungsi, ...args) {
  return panggilDenganOpsi({ batas: ms }, namaFungsi, ...args);
}

async function panggilDenganOpsi(opsi, namaFungsi, ...args) {
  const url = ambilUrlApi();
  const kunci = ambilKunciAkses();
  if (!url || !kunci) throw new GalatApi('Aplikasi belum dihubungkan ke Google (URL API / kunci akses kosong).', 'BELUM_TERHUBUNG');
  if (!navigator.onLine) throw new GalatApi('tidak ada internet', 'OFFLINE');

  const pengendali = new AbortController();
  const tunda = opsi.batas ? setTimeout(() => pengendali.abort(), opsi.batas) : null;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: namaFungsi, args: args, kunci: kunci }),
      redirect: 'follow',
      signal: pengendali.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new GalatApi('Waktu habis', 'WAKTU_HABIS');
    throw new GalatApi('Tidak bisa menghubungi server (' + err.message + ')', 'JARINGAN');
  } finally {
    if (tunda) clearTimeout(tunda);
  }

  let hasil;
  const teks = await res.text();
  try {
    hasil = JSON.parse(teks);
  } catch (e) {
    // Biasanya halaman login/HTML Google: deploy bukan "Anyone" atau URL salah
    throw new GalatApi('Server tidak membalas JSON. Pastikan URL berakhiran /exec dan deploy "Who has access: Anyone".', 'BUKAN_JSON');
  }
  if (!hasil || !hasil.success) {
    throw new GalatApi(hasil && hasil.message ? hasil.message : 'Respons server kosong.', hasil && hasil.kode);
  }
  return hasil.data;
}
