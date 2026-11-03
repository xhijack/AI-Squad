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

## Halaman Admin (1.10)

Semua pengaturan ada di **`/admin`**: halaman sendiri tanpa scene 3D, ringan di HP, dengan alamat per bagian
(`/admin#/targets`, `/admin#/spaces/<id>`). Sidebar dibagi enam kelompok: Ringkasan (yang butuh kamu, target,
agent bekerja, biaya hari ini, semua Space), Perusahaan (rencana, target, ritme, Company Brain), Space dan tim,
Pekerjaan (antrean, handoff, perbaikan, riwayat perubahan), Koneksi (integrasi, ERPNext, Telegram, login Claude,
suara), dan Owner (orang dan akses, legal, mesin, backup, gedung dan pembaruan). **Ctrl/Cmd+K** mencari bagian
atau Space. Kantor (`/`) tetap tempat melihat dan bekerja dengan agent.

**Perbarui dari aplikasi**: kalau dipasang dengan `install.sh`, Admin → Gedung dan pembaruan menunjukkan versi baru
beserta catatan rilisnya; **Perbarui sekarang** menarik versi baru dan memulai ulang server beberapa detik (agent
di terminal tetap jalan). Tidak jalan kalau folder aplikasi punya perubahan lokal atau ada job latar belakang.

## Agent belajar, Owner menyetujui (1.11)

Agent tidak pernah menulis Company Brain sendiri. Kalau ia belajar sesuatu yang perlu disimpan perusahaan, ia
menulis **usulan** di Space-nya (`docs/squad/proposals/`): sebuah **fakta** (masuk `FACTS.md` di Company Brain dan
dibaca semua agent), sebuah **dokumen** Company Brain (SOP, template, aturan brand, produk), atau sebuah **skill**
(dipasang di Space itu atau semua Space). Usulan muncul sebagai kartu "Pembelajaran: perlu disetujui" dan di
**Admin → Pembelajaran**: lihat perubahannya, ubah dulu bila perlu, Setujui atau Jangan sekarang (dengan catatan yang
dibaca agent). Fakta bisa disetujui langsung dari kartunya; dokumen dan skill dibaca dan disetujui di Admin →
Pembelajaran. Setiap versi lama disimpan (di luar Company Brain) dan bisa **dikembalikan**.

## Penerbitan dengan aturan (1.12)

Agent tidak pernah menerbitkan sendiri. Post, pesan ke lead atau pelanggan, iklan, atau deploy ditulis sebagai
**permintaan** di Space-nya (`docs/squad/outbox/`). Tool penerbitan (misalnya Postiz) ditandai Owner di
**Admin → Integrasi** ("Menerbitkan: post / pesan / iklan"); tool itu diblokir untuk semua agent dan hanya server yang
memanggilnya. Di **Admin → Penerbitan** kamu atur per Space dan per kanal: *menunggu kamu*, *setelah reviewer* (Claude
mengecek terhadap brand dan fakta perusahaan), atau *sendiri*, dengan batas per hari. Iklan, deploy production, tool
berbayar, topik uang dan legal, serta Space Legal selalu menunggu kamu. Kartunya bisa disetujui satu ketuk (juga di
Telegram) bila seluruh isinya muat; kalau tidak, baca dulu di Admin → Penerbitan. Bukti kirim (jawaban kanal) disimpan.

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

## SEO & GEO dan konektor Google (1.8)

- **SEO & GEO**: squad pencarian saja (di Panduan Perusahaan: Marketing → *Pencarian saja (SEO dan jawaban AI)*).
  SEO & GEO Strategist (lead, satu-satunya yang bicara denganmu), Technical SEO Specialist, Keyword Researcher, Content
  Writer, GEO Analyst (panel prompt AI di `docs/seo/PROMPTS.md`, dicek sebulan sekali) dan, untuk klinik dan toko,
  Local SEO Specialist. Hanya data gratis: tanpa OpenSEO dan tanpa data SEO berbayar. Hard stop: tidak publikasi, tidak
  mengubah halaman live, tidak IndexNow dan tidak email outreach tanpa persetujuanmu; tanpa teknik black-hat; tidak
  pernah mengarang peringkat, volume, kutipan atau testimoni.
- **Konektor Google**: buat service account di Google Cloud, aktifkan Search Console API dan Google Analytics Data
  API, buat kunci JSON lalu unggah di Admin → Integrasi → Google (yang terlihat hanya e-mailnya). Tambahkan e-mail itu
  di Search Console (Settings → Users and permissions) dan di GA4 (Property access management, peran Viewer), lalu isi
  properti tiap Space di Pengaturan Lantai → Google dan tekan **Uji**. Kunci tidak pernah masuk ke repositori, Log,
  browser atau agent. Data Search Console terlambat sekitar 2 hari, jadi periodenya berakhir 2 hari lalu.
- **Target dari Google**: Admin → Target → Sumber *dari Google* (klik, impresi, sesi organik, sesi dari asisten AI,
  skor PageSpeed). Agen membaca data yang sama lewat alat `aisquad-google`; IndexNow selalu menanyakanmu dulu di Meja
  dan tidak pernah berjalan otomatis.
- **Tool berbayar nanti**: di Admin → Integrasi setiap tool bisa ditandai **berbayar**: tidak pernah dipakai otomatis,
  ditanyakan dulu di Meja, dan tidak pernah jadi sumber target.

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

## Akses online (1.9)

Web 3D bisa dibuka dari mana saja tanpa membuka port di mesin: server tetap di `127.0.0.1:8097`, di depannya
**Cloudflare Tunnel + Cloudflare Access** (disarankan), **Caddy atau Nginx dengan HTTPS** di VPS, atau **Tailscale**
(privat). Langkah, contoh konfigurasi dan daftar cek VPS ada di [INSTALL.md](../../INSTALL.md), bagian *Online*.

- **Mode publik** (`--public`, `prefs.public: true` di `~/.aisquad/building.json`, atau otomatis begitu ada request
  lewat proxy): semua halaman dan data butuh orang yang sudah masuk; sebelum itu hanya halaman masuk yang tampil.
- **Masuk**: PIN dikirim sekali, browser hanya menyimpan cookie sesi (bukan PIN). Sesi berakhir setelah 12 jam tidak
  dipakai atau 7 hari, lewat Menu → **Keluar**, atau untuk semua orang lewat **Keluar dari semua perangkat** (Owner).
- **PIN salah**: 5 kali dari satu alamat dalam 15 menit membuat alamat itu menunggu (5 menit, berlipat sampai 1 jam).
  20 kali dalam sehari mengunci masuk dengan PIN untuk semua orang sampai Owner menjalankan `/aisquad unlock` di mesin
  atau mengirim `/unlock` di Telegram. Setiap penguncian dikabarkan ke Telegram Owner.
- **Verifikasi kedua Owner**: bila chat Telegram Owner sudah terhubung, sesi Owner di mode publik memasukkan kode dari
  Telegram sebelum mengubah pengaturan, rahasia, orang, merge, atau membuka Space khusus Owner.
- `/aisquad doctor` memeriksa alamat server, HTTPS di depan, file sesi dan status kunci PIN.

## Keamanan singkat

PIN untuk setiap perubahan; Owner/Member/Viewer; rahasia (API key, token) hanya disimpan di mesin ini dan tidak pernah
tampil lagi; data pribadi disamarkan di Squad Log. Detail: [SECURITY.md](../../SECURITY.md).
