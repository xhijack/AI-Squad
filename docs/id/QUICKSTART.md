# Mulai cepat

The AI Squad berjalan di mesin kamu sendiri (Linux, macOS, atau WSL) dan menjalankan agent Claude Code. Instalasi
bersih hanya butuh beberapa menit.

## 1. Yang dibutuhkan

- Node.js 22 atau lebih baru, git, dan tmux
- Claude Code yang sudah login: `curl -fsSL https://claude.ai/install.sh | bash`, lalu jalankan `claude` sekali
  ([panduan setup](https://code.claude.com/docs/en/setup))
- Paket Claude yang mencakup Claude Code, atau API key untuk pekerjaan latar belakang (lihat [BILLING.md](../BILLING.md))

## 2. Satu perintah

```
curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash
```

Perintah ini memeriksa mesin (dan memberi tahu cara memasang yang kurang), memasang The AI Squad di
`~/.aisquad-app`, membuat perintah `aisquad` di `~/.local/bin`, menjalankan server sebagai service user, dan membuka
`http://127.0.0.1:8097`. PIN kamu ditampilkan (setiap perubahan memerlukannya; tersimpan di `~/.aisquad/pin`). Tidak
ada yang dipasang dengan `sudo`.

Langsung dengan squad pertama:

```
curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash -s -- --blueprint erp-consultant --name "Implementasi Klinik"
```

Blueprint: `software-house`, `erp-consultant`, `sales-crm`, `digital-marketing`, `product`, `legal` (khusus Owner).
Branch lain: tulis `AISQUAD_BRANCH=development` sebelum `bash`.

## 3. Langkah pertama di aplikasi

1. **Siapkan Perusahaan** (terbuka sendiri saat Gedung masih kosong): pilih bahasa, jawab beberapa pertanyaan
   (usaha, tujuan, yang sudah ada, divisi, seberapa otomatis, mesin dan budget), periksa rencananya, tekan **Bangun**.
   Hasilnya satu Space per divisi dengan target awal, jam kerja, dan daftar bahan yang masih dibutuhkan darimu;
   rencananya ada di Company Brain (`PLAN.md`). Bisa dijalankan lagi dari Lobby untuk menambah divisi.
   Atau **Siapkan Squad** untuk satu tim saja: jelaskan apa yang ingin dibangun; pilih Blueprint dan timnya.
2. Buka Space-nya dan jalankan lead-nya: lead akan meminta bahan dan dokumen sumber (PRD, BRD, brief…) lebih dulu.
3. **Menu → Admin**: Space (jenis, akses, shift, mesin, ERPNext), pengguna dan PIN-nya, Telegram, backup.
4. Opsional: **Admin → Notifikasi** untuk menjawab agent dari Telegram, **Admin → Mesin** untuk menambah mesin worker.

## 4. Sebagai plugin Claude Code

```
/plugin marketplace add xhijack/AI-Squad
/plugin install aisquad@aisquad
/aisquad
```

## 5. Update, hentikan, hapus

```
bash ~/.aisquad-app/install.sh      # update ke versi terbaru dari branch-nya lalu restart
aisquad stop                        # hentikan server (agent tetap berjalan di tmux)
aisquad uninstall                   # hapus service; ~/.aisquad dan Space kamu tetap ada
```

Sebelum pindah mesin, buat backup: `aisquad backup` (lihat README, bagian "Backups and moving to another machine").
