# Panduan The AI Squad (Bahasa Indonesia)

The AI Squad menjalankan tim agent Claude Code sebagai satu "perusahaan": setiap proyek atau departemen adalah
sebuah **Space** (di kode: Floor), dan semuanya terlihat di satu layar. Mulai dari [QUICKSTART](QUICKSTART.md).
Dokumentasi lengkap (bahasa Inggris) ada di [README](../../README.md).

## Space dan tim

- **Space** = satu repositori dengan satu tim agent. Jenisnya *project* (satu klien/produk) atau *department*
  (Sales, Marketing, Legal). Akses *Team* atau *Owner only*: Space khusus Owner tidak terlihat oleh orang lain.
- **Blueprint** menyiapkan tim, dokumen sumber, dan aturan kerja: Software House, ERP Consultant, Sales & CRM,
  Digital Marketing (shift malam), Product, Legal (khusus Owner), Keuangan (khusus Owner, 1.7) dan Dukungan (1.7).
- **Siapkan Perusahaan** (1.4): pemandu untuk pemilik yang belum tahu harus mulai dari mana. Beberapa pertanyaan
  dalam bahasamu, lalu rencana: satu Space per divisi (boleh satu saja), target awal dari tujuanmu, mode kerja
  (otomatis, diawasi, manual; Legal dan Keuangan mulai manual kecuali kamu ubah), jam kerja, budget, dan daftar bahan per divisi
  (ada / belum / nanti). Yang belum ada menjadi tugas pertama lead: mewawancaraimu dan membuat drafnya.
  Bahasa yang kamu pilih dipakai aplikasi dan agent saat bicara denganmu; kode dan dokumen teknis tetap Inggris.
  Dukungan disarankan untuk SaaS, software house dan konsultan ERPNext; Keuangan untuk bisnis yang sudah memakai
  ERPNext, dan selalu dibangun khusus Owner.
- **Panduan di Telegram** (1.7): ketik `/guide` di chat Telegram Owner. Satu pertanyaan per pesan dengan tombol,
  jawaban teks untuk nama, kalimat dan angka (`30.000.000`), tombol Kembali dan Batal. Jawaban tersimpan di file yang
  sama dengan aplikasi, jadi bisa dilanjutkan di mana saja. Di akhir bot mengirim rencananya dan tautan ke aplikasi:
  **Build hanya dari aplikasi** (butuh PIN dan tinjauan yang teliti). Anggota dan Viewer mendapat penolakan yang sopan.
- **Company Brain** (L0): SOP, brand, template, produk; folder legal, keuangan, dan harga hanya untuk Space Owner.
  Agent hanya membaca, tidak pernah mengubah.

## Bekerja dengan agent

- **Desk**: layar agent, tugas, pertanyaan (Attention), riwayat. **Chat**: pesan langsung ke agent mana pun.
- **Dispatcher**: semua start lewat satu antrean (P0 kamu, P1 handoff, P2 kerja biasa, P3 latar belakang); jumlah
  agent sekaligus mengikuti RAM, CPU, dan kuota. Shift menahan kerja otomatis di luar jamnya.
- **Autopilot** menjawab pertanyaan rutin; daftar **hard stop** (uang, legal, produksi, rahasia, tak bisa dibatalkan)
  selalu menunggu kamu. Di Telegram, hard stop perlu kode 4 digit.

## Tampilan

Gedung (3D atau Iso Pixel), **Kantor** (denah satu perusahaan: departemen, proyek, Ruang Server, Lobi antrean,
Ruang Owner), dan **Daftar** (bawaan di HP). Menu → Tampilan memilih 3D, Iso Pixel, atau Auto.

## Antar-Space dan ERPNext

- **Handoff**: agent menulis paket ke `docs/squad/handoffs/outbox/`; server mengantarnya ke Space lain dan
  membangunkan penerimanya. Pertanyaan kembali sebagai *clarify*, hasil sebagai *done*. Paket yang keluar dari Space
  khusus Owner menunggu persetujuanmu.
- **ERPNext** lewat Frappe Assistant Core dengan key per peran (Admin → ERPNext, panduan [ERPNEXT.md](../ERPNEXT.md)).
  Lead baru masuk ke Sales; Quotation yang diserahkan agent menjadi **persetujuan harga** yang hanya bisa kamu
  setujui; order menjadi handoff project tanpa harga.

## Legal

Kontrak dibuat dari template dwibahasa yang terkunci di Company Brain dan diperiksa dengan checklist (Pasal 1320
KUHPerdata, UU 24/2009, UU PDP, TTE, bea meterai). Setiap kontrak tetap **DRAFT** sampai kamu menyetujuinya di
aplikasi; kontrak yang ditandai APPROVED dengan cara lain dikembalikan ke DRAFT. Ini alat bantu penyusunan, bukan
nasihat hukum.

## Keuangan dan Dukungan (1.7)

- **Keuangan** (khusus Owner): Finance Controller (tutup buku bulanan, arus kas, anggaran vs realisasi, draf
  penagihan piutang) dan Bookkeeper (rekonsiliasi bank, anomali, kertas kerja pajak). Membaca ERPNext dengan **kunci
  keuangan yang hanya baca** (Admin → ERPNext → Finance). Hard stop: tidak membayar, tidak submit atau cancel dokumen
  ERPNext, tidak lapor pajak, tidak mengirim invoice atau pengingat ke pelanggan tanpa persetujuanmu, data gaji tidak
  keluar dari Space ini. Di Telegram hanya jumlahnya yang dikirim, tanpa nominal atau nama.
- **Dukungan**: Support Lead (triase sesuai SLA, laporan mingguan, eskalasi ke Space produk atau engineering lewat
  handoff) dan Support Agent (draf balasan dari basis pengetahuan `docs/kb/`). Mode diawasi: setiap balasan menunggu
  persetujuan; mode otomatis: hanya jawaban yang mengutip artikel KB yang sudah APPROVED. Skill `kb-writer` mengubah
  tiket yang selesai menjadi artikel tanpa data pribadi pelanggan (nama, telepon, email disamarkan).
- **Ubah sumber target** (Admin → Target → Ubah sumbernya): ganti sumber target (manual, ERPNext, CSV, webhook,
  integrasi) tanpa menghapusnya. Riwayatnya tetap; nilai dari sumber baru memulai garis baru, dan perubahan tercatat di
  Squad Log (`kpi.source.changed`).

## Biaya dan pembelajaran

- **Tingkatan model** (Admin → Dispatcher): pekerjaan rutin di latar belakang memakai model lebih ringan; biaya per
  job sebelum dan sesudah ditampilkan.
- **Daily Insight** (Admin → Perbaikan): tiap malam membaca minggu sebelumnya dan memberi saran. **Tangga
  kepercayaan**: level 0 semua saran menunggu kamu; level 1 (harus "diraih" per kategori) menjalankan saran berisiko
  rendah sebagai canary 7 hari, lalu kamu pertahankan atau batalkan.
- **Naikkan pelajaran**: pelajaran dari sebuah Space menjadi aturan Role Template setelah identitas klien dihapus,
  selalu dengan persetujuanmu.

## Mesin dan backup

- **Admin → Mesin**: tambah mesin worker (`aisquad node`) alih-alih upgrade satu mesin; job latar belakang ditempatkan
  di mesin yang ada slot, konteks lewat git.
- **Backup**: `aisquad backup` (terenkripsi bila ada passphrase), backup malam, `aisquad restore` di mesin baru.

## Keamanan singkat

PIN untuk setiap perubahan; Owner/Member/Viewer; rahasia (API key, token) hanya disimpan di mesin ini dan tidak pernah
tampil lagi; data pribadi disamarkan di Squad Log. Detail: [SECURITY.md](../../SECURITY.md).
