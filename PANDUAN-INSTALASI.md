# PANDUAN INSTALASI — GeoFoto Lahan v3 (GitHub Pages + Apps Script)

Aplikasi ini sekarang terdiri dari **dua bagian**:

| Bagian | Isi | Tempatnya |
|---|---|---|
| **Backend** | `Kode.gs` | Google Apps Script (proyek yang sama seperti sebelumnya) |
| **Frontend** | isi ZIP `geofoto-lahan.zip` | Repository GitHub → GitHub Pages |

Urutan pengerjaan: **Backend dulu** (untuk mendapat URL API dan kunci akses), **baru** GitHub.

---

## BAGIAN A — Backend (Google Apps Script)

1. Buka proyek Apps Script GeoFoto Lahan yang lama di https://script.google.com.
2. **Hapus** file `Index`, `Stylesheet`, dan `JavaScript` (tampilan sekarang pindah ke GitHub).
3. Ganti seluruh isi `Kode.gs` dengan `Kode.gs` versi baru (v3.0).
4. Pilih fungsi **`setupAppEnvironment`**, lalu klik ▶ **Run**. Izinkan akses bila diminta.
5. Buka **Execution Log** dan catat baris ini:
   ```
   🔑 Kunci akses  : XXXXXXXX
   ```
   Folder Drive dan spreadsheet lama **tetap dipakai**, jadi data lama tidak hilang.
6. Klik **Deploy → Manage deployments → ✏️ Edit**:
   - Version: **New version**
   - Execute as: **Me**
   - Who has access: **Anyone** ← wajib, supaya bisa dipanggil dari GitHub Pages
   - Klik **Deploy**, lalu salin **URL Web App** (berakhiran `/exec`).
7. Tes: buka URL `/exec` itu di browser. Harus muncul teks berisi `"status":"API aktif"`.

> 🔒 **Kenapa aman walau "Anyone"?** Setiap permintaan dari aplikasi wajib membawa kunci akses. Tanpa kunci yang benar, server menolak. Ganti kunci kapan saja dengan menjalankan fungsi `buatKunciAksesBaru`.

---

## BAGIAN B — Frontend (GitHub Pages)

### Struktur folder (hasil ekstrak ZIP)

```
geofoto-lahan/          ← DI FOLDER INILAH git init dijalankan
├── index.html          ← harus terlihat paling atas saat `dir`
├── manifest.json
├── sw.js
├── README.md
├── PANDUAN-INSTALASI.md
├── css/
│   └── style.css
├── img/
│   ├── icon-192.png
│   └── icon-512.png
└── js/
    ├── config.js       ← tempat URL API (opsional)
    ├── api.js
    └── app.js
```

### (Opsional) Isi URL API di `js/config.js`

```js
const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Jika dikosongkan, aplikasi akan menanyakan URL saat pertama dibuka.
⚠️ **Jangan** menulis kunci akses di file mana pun, karena repository GitHub bersifat publik.

### Langkah Git

1. Install Git: https://git-scm.com/download/win (pengaturan default), lalu buka **PowerShell**.
2. Identitas (sekali saja):
   ```
   git config --global user.name "Nama Anda"
   git config --global user.email "email-akun-github@gmail.com"
   ```
3. Di github.com: **+ → New repository** → nama `geofoto-lahan` → **Public** → **jangan** centang README → **Create**.
4. Masuk ke folder hasil ekstrak, lalu cek isinya:
   ```
   cd "C:\Users\NAMA\Downloads\geofoto-lahan"
   dir
   ```
   Harus terlihat `index.html`, `css`, `js`, `img`. Jika yang terlihat hanya satu folder `geofoto-lahan`, jalankan `cd geofoto-lahan` dulu.
5. Kirim ke GitHub (satu per satu):
   ```
   git init
   git add .
   git commit -m "Upload pertama"
   git branch -M main
   git remote add origin https://github.com/USERNAME/geofoto-lahan.git
   git push -u origin main
   ```
   Saat diminta **Password**, tempel **Personal Access Token** (bukan password akun). Layar memang tidak menampilkan apa pun saat mengetik, dan itu normal.
   Cara membuat token: https://github.com/settings/tokens → *Generate new token (classic)* → centang **repo** → salin `ghp_...`.
6. Di repository: **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → **Save**.
   Tunggu 1–2 menit. Situs tersedia di `https://USERNAME.github.io/geofoto-lahan/`. Pastikan **Enforce HTTPS** tercentang, karena kamera dan GPS hanya berjalan di HTTPS.

### Pertama kali dibuka di HP

1. Buka `https://USERNAME.github.io/geofoto-lahan/` di **Chrome HP**.
2. Isi **URL API** (`/exec`) dan **kunci akses**, lalu klik **Hubungkan**.
3. Izinkan **Lokasi** saat diminta.
4. Menu Chrome **⋮ → Tambahkan ke layar utama** membuat aplikasi tampil seperti aplikasi biasa dan **tetap bisa dibuka tanpa sinyal**.

---

## Memperbarui aplikasi nanti

- **Frontend berubah:** dari folder `geofoto-lahan`, jalankan
  ```
  git add .
  git commit -m "Keterangan perubahan"
  git push
  ```
  Jika tampilan belum berubah, tutup lalu buka ulang aplikasi (atau tekan Ctrl+Shift+R di laptop).
- **Backend berubah:** edit `Kode.gs` → **Deploy → Manage deployments → Edit → New version**. URL tetap sama.

## Masalah umum

| Gejala | Solusi |
|---|---|
| "Server tidak membalas JSON" | Deploy belum **Anyone**, atau URL bukan yang berakhiran `/exec` |
| "Kunci akses ditolak" | Salin ulang kunci dari Execution Log (huruf besar semua, tanpa spasi) |
| Situs GitHub 404 | `index.html` tidak berada di root repository. Push ulang dari folder yang benar |
| Tampilan polos tanpa warna | Folder `css/` dan `js/` tidak ikut. Jangan upload lewat web, pakai `git push` |
| GPS/kamera tidak jalan | Pastikan alamat diawali `https://` dan izin Lokasi/Kamera untuk situs diizinkan |
