# legacies kullanım rehberi

Bu rehber legacies'i günlük işte nasıl kullanacağını anlatır. Tüm seçenekler ve teknik ayrıntılar [README](../README.md) dosyasında.

legacies dört iş yapar:
- **Hafıza:** Her projenin kararlarını, tuzaklarını ve nerede kaldığını o projenin `.legacies/` klasöründe tutar. Her oturum bu bilgiyle başlar.
- **Kod haritası (graphify):** Projenin kodunu tarayıp hangi fonksiyonun nerede olduğunu ve neyin neyi çağırdığını çıkarır. Kurulumla birlikte gelir, harita kendiliğinden oluşur ve güncel tutulur. Senin bir şey yapman gerekmez.
- **Paketler:** Projenin teknolojilerine uyan skill, ajan ve kuralları yalnızca o projede açar.
- **Korumalar:** `--no-verify` kullanımını ve koda yazılan sırları engeller. Lint ya da format ayarı değişecekse sana sorar.

## 1. Bilgisayarı hazırla (bir kez)

1. legacies'i kalıcı bir klasöre al: `git clone https://github.com/FurkanSahinnn/legacies.git ~/legacies` (Windows PowerShell'de hedef `$HOME\legacies`). Plugin oradan yüklendiği için klasörü sonradan taşıma ya da silme.
2. Klasörde kurulum programını çalıştır:
   - Windows: `.\install.cmd`
   - macOS / Linux: `sh install.sh`
3. Kurulum önce gereken programları denetler: Node 18+, git ve Claude Code veya OpenCode'dan en az biri. Eksik varsa nasıl kurulacağını gösterir ve hiçbir şeyi değiştirmeden durur.
4. "Şimdilik hiçbir projeye kurma" seçili gelir. Bu adım Claude varsa marketplace kaydını, terminaldeki `legacies` komutunu ve kod haritası motoru graphify'ı hazırlar (bir kez, ~140 MB, internetten indirilir). Hiçbir projeye kurulum yapılmaz.
5. Kutunun altında bir PATH komutu çıkarsa onu çalıştır ve yeni bir terminal aç.

## 2. Bir projeye kur (her proje için bir kez)

1. Terminalde projenin **kök klasörüne** git ve `legacies setup` çalıştır. Kurulum yalnız bu projeye yapılır; diğer projelerine dokunulmaz.
2. "Yalnız bu projede, yalnız bu bilgisayarda" önerilir. Projeye eklenen dosyalar git'ten gizlenir; commit'lenen hiçbir dosya değişmez.
3. Ek bileşenler listesi gelir: kodlama kuralları, `legacies` komutu, kuruluysa Codex ve OpenCode adaptörleri ve çoklu ajan düzeni (açarsan denge sorulur; bkz. 7. bölüm). Enter ile aç ya da kapat. Bitince en alttaki **[ Onaylıyorum ]** satırına gel (en üstteyken ↑ doğrudan oraya götürür), Enter'a bas ve "Emin misiniz?" sorusuna evet de. Hayır dersen seçimlerin kalır, düzenlemeye devam edersin.
4. Plan gösterilir. Onay verince sırayla şunlar kurulur:
   - çekirdek,
   - kodlama kuralları,
   - Codex kuruluysa projenin Codex hook'ları,
   - OpenCode kuruluysa projenin OpenCode adaptörü.
5. Paket ekranı açılır; projede tespit edilen teknolojiler işaretli gelir. Tuşlar aynı: Enter aç ya da kapat, bitince en alttaki **[ Onaylıyorum ]**. Ayrıca `a` bir grubun hepsini açıp kapatır.
6. Kullandığın ajanı **aynı klasörde** aç. Claude Code'da `/legacies:onboard`, OpenCode'da `onboard` skill'i ya da ikisinde de "projeyi tanı" diyebilirsin. Proje bir kez incelenir ve hafızası kurulur.

> Claude Code'u projenin kök klasöründe açman gerekir. Üst ya da alt bir klasörde açılan oturum legacies'i görmez.

## 3. Kendiliğinden olanlar

Bunlar için bir şey yapman gerekmez:

| Ne zaman | legacies ne yapar |
|---|---|
| Oturum başında | Proje kartını, güncel durumu, son devir kartını ve not dizinini bağlama ekler |
| Her mesajda | Mesajla ilgili notları ve kod konumlarını ekler; ilgili bir şey yoksa sessiz kalır. Bir düzeltme istediğinde önce hatayı gösteren testin yazılmasını hatırlatır |
| Araç çağrılarında | `--no-verify`'ı ve koda yazılan sırları engeller; lint ya da format ayarı değişecekse sana sorar |
| Bir alt ajan başlarken | Ona hafızanın kısa bir özetini verir: notların başlıkları ve proje kartı. Alt ajan not ya da kart yazmaz; bulduklarını ana oturuma bildirir |
| Konuşma sıkıştırılırken | Kontrol noktası kaydeder; sıkıştırmadan sonra son isteklerin birebir geri gelir |
| Bitirirken | Son karttan beri dosya değiştiyse ve 3+ dosya ya da 45 dakika dolduysa bir kez devir kartı ister (en fazla 30 dakikada bir) |
| Oturum kapanınca | Kart yazılmamışsa ve düzenleme ya da en az 3 istek varsa mekanik bir kart bırakır |

Hafıza notları bağlama "veri, talimat değil" diye eklenir. Bir not kodla çelişirse kod esas alınır ve not düzeltilir.

## 4. İsteyebileceklerin

Komut yazman gerekmez: Claude aşağıdaki cümlelerde ilgili skill'i kendisi açar. İstersen komutu da yazabilirsin.

| İstek | Örnek cümle | Komut |
|---|---|---|
| Bir şeyi kalıcı not et | "bunu hatırla", "not al", "unutma" | `/legacies:remember` |
| Önceki kararları bul | "daha önce ne karar vermiştik", "bunu konuşmuştuk" | `/legacies:recall` |
| Kodun yerini bul | "bu nerede", "hangi dosyada", "neyi etkiler" | `/legacies:code-map` |
| Nerede kaldığını kaydet | "devir kartı yaz", "nerede kaldık yaz" | `/legacies:handoff` |
| Projeyi tanıt ya da kartı tazele | "projeyi tanı", "hafızayı kur" | `/legacies:onboard` |
| Paketleri gör ya da değiştir | "hangi skill'ler kurulu", "bu projeye ne lazım" | `/legacies:packs` |
| Başka bir projeye taşı | "mobile'a geçir", "ne kaldı" | `/legacies:migrate` |
| Bir hatanın nedenini bul | "neden bozuldu", "test kırıldı", "hata veriyor" | `/legacies:debugging` |
| Ne yapılacağını netleştir | — | `/legacies:spec` |
| Kod yazmadan önce plan | — | `/legacies:plan` |
| PR ya da değişiklik incelemesi | — | `/legacies:review-pr` |

`/legacies:spec`, `/legacies:plan` ve `/legacies:review-pr` yalnızca sen yazınca çalışır. Büyük bir iş için sıra: önce `spec` (ne yapılacak), sonra `plan` (nasıl ve hangi sırayla).

Süreç skill'leri işe göre kendiliğinden devreye girer:
- `tdd-workflow`: bir davranışı değiştirirken ya da bilinen bir hatayı düzeltirken; "TDD ile yap" ya da "önce test" dediğinde de. İşi ince dilimlerle yapar, her dilimde önce başarısız olan bir test yazar.
- `debugging`: bir test kırıldığında, derleme bozulduğunda ya da "ne bozuldu" diye sorduğunda. Önce kök nedeni bulur, sonra regresyon testiyle düzeltir.
- `verification-loop`: bir işi bitirdiğinde ya da "verify" dediğinde.
- `search-first`: yeni bir yardımcı ya da bağımlılık eklemeden önce; framework kodunu ezberden yazmadan önce kullanılan sürümün resmi belgesine de bakar.

Bu süreç skill'leri [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)'ten uyarlandı. Commit yalnızca sen istediğinde yapılır; spec ve planlar `.legacies/` altında kalır.

## 5. Teknoloji paketleri

- **Değiştirmek:** Terminalde `legacies packs` seçim ekranını açar. Claude Code içinde "şu paketi ekle" demek de yeter.
  - `legacies packs suggest`: bu projede tespit edilenleri listeler.
  - `legacies packs on react` ve `legacies packs off react`: tek bir paketi açar ya da kapatır. Kapatılan paket kurulu kalır, kuralları projeden çekilir; yeniden açmak anında olur.
  - `legacies packs remove react`: paketi tamamen siler. Önce "Emin misin?" diye sorar; sormadan silmek için `--yes`.
- **Kendi skill'lerin:** `legacies catalog add <klasör ya da git adresi>` kişisel kataloğa ekler. Eklediğin skill'ler `legacies packs` ekranında "Kendi eklediklerin" altında görünür.
- **Değişikliği yüklemek:** Açık oturumda `/reload-plugins` çalıştır. Yeni oturumlar kendiliğinden yükler.

## 6. Birden çok projeyle çalışmak

| Durum | Ne yap |
|---|---|
| Kısa süre başka bir repoya bakacaksın | Oturumda `/add-dir <klasör>`. Eklenen projenin özeti ve ilgili notları gelir, düzenlemeler o projenin kaydına yazılır. Hepsinde aramak için: `legacies search "<terimler>" --all` |
| Projeler hep birlikte çalışıyor (ör. web ve mobil) | `legacies workspace add <ad> <klasör1> <klasör2>`, açmak için `legacies open <ad>`. Ortak bir not için: `legacies add --workspace <ad> ...` |
| Bir projeyi diğerine taşıyorsun | `legacies migrate start <ad> --from <kaynak> --to <hedef>`. Sonra Claude Code'da "ne kaldı" de ya da `legacies migrate next <ad>` çalıştır |

Çalışma alanlarının ortak hafızası hiçbir reponun içinde değildir: `~/.claude/legacies-workspaces/<ad>/`.

## 7. Çoklu ajan düzeni

Açıkken Claude işi alt ajanlara dağıtırken her birine işine uygun model ve effort'u verir: incelemeyi dikkatli, aramayı ucuz yaptırır. Varsayılan olarak kapalıdır.

- **Açmak ve kapatmak:** `legacies multiagent on` ve `legacies multiagent off`. Kapatmak hiçbir şeyi silmez.
- **Ayarlamak:** Terminalde `legacies multiagent` ayar ekranını açar. Orada şunları seçersin:
  - denge: Dengeli, Kalite, Maliyet ya da Özel,
  - her rolün modeli ve effort'u,
  - aynı anda en fazla kaç ajan çalışacağı,
  - başarısız işin yeniden denenip denenmeyeceği,
  - hangi ajanın hangi rolde olduğu.
- **Tüm projelerin varsayılanı:** `legacies multiagent default ...`. Kendi ayarı olan proje kendi ayarını kullanır.
- **Claude'a söylemek de yeter:** "çoklu ajanı maliyet moduna al".
- **Ne zaman geçerli:** Değişiklik yeni oturumda geçerli olur.

## 8. Codex ve OpenCode

Codex kuruluysa `legacies setup` projeye Codex hook'larını da ekler: `.codex/hooks.json`, git'e girmez. Hook'ların çalışması için iki adım gerekir:
1. Codex'te projeye güven.
2. `/hooks` ekranında legacies hook'larını onayla.

Hook'u olmayan bir AI için oturum başında `legacies context` aynı bağlamı verir.

OpenCode kuruluysa `legacies setup` projeye `.opencode/plugins/legacies.js` ekler ve git'ten gizler. OpenCode'u proje klasöründe yeniden başlatınca 14 çekirdek skill, hafıza bağlamı, düzenleme kaydı, korumalar ve devir kartı hatırlatıcısı etkinleşir. Elle yönetmek için `legacies opencode install|status|uninstall` kullan. Diğer OpenCode plugin'leri ve ayarları korunur.

## 9. Terminalde sık kullanılanlar

```sh
legacies search "<terimler>"     # hafızada ara
legacies map "<ad ya da konu>"   # kodun yerini bul
legacies graph affected "<ad>"   # bu değişirse neyi etkiler
legacies graph status            # kod haritasının durumu
legacies multiagent              # çoklu ajan düzeni: aç/kapat, ayar ekranı
legacies doctor                  # bu projede eklenti açık mı, hafıza ve hook sağlığı
legacies help                    # tüm komutlar
```

## 10. Sorun giderme

| Belirti | Çözüm |
|---|---|
| legacies hiç görünmüyor | Ajanı projenin kök klasöründe aç. Kurulu olup olmadığını o klasörde `legacies doctor` söyler; Claude için `Eklenti (bu proje)`, OpenCode için `OpenCode adaptörü` satırına bak. Yoksa `legacies setup` çalıştır |
| Paket ya da ayar değişikliği yansımadı | Açık oturumda `/reload-plugins` çalıştır ya da Claude Code'u yeniden başlat |
| Bir hook hata veriyor gibi | `legacies doctor` son hataları gösterir. Hook'lar hata verse bile oturumu bozmaz |
| Hatırlatmalar ya da öneriler fazla | `.legacies/config.json` dosyasını düzenle ya da `LEGACIES_STOP_REMINDER=off` / `LEGACIES_PROMPT_CONTEXT=off` kullan (README → Ayarlar) |
| legacies'i geçici olarak kapatmak | Claude Code'u `LEGACIES_DISABLED=1` ile başlat |
| Bir not yanlış | Notu düzelt ya da Claude'a söyle, sonra `legacies verify <dosya>` çalıştır |

## 11. Güncelleme ve kurulumu tekrar çalıştırmak

- **Güncellemek:** legacies klasöründe `git pull` çalıştır. Sonra legacies kullandığın her projede bir kez `legacies setup` çalıştır: projeye kopyalanan kurallar ve graphify sürümü böyle tazelenir. Açık oturumda `/reload-plugins`.
- **Tekrar çalıştırmak güvenli:**
  - Yapılmış adımlar "zaten kurulu" diye atlanır.
  - Kurallar güncel sürümle yeniden yazılır; senin kendi kural dosyalarına dokunulmaz.
  - Hafızaya (`.legacies/`) dokunulmaz.
  - Onay vermeden hiçbir şey değişmez. Yalnız planı görmek için: `legacies setup --dry-run`.
- **Paket ekranında dikkat:** Açık paketler işaretli gelir. Projede tespit edilip kapalı olanlar da öneri olarak işaretli gelir; bilerek kapattığın bir paket varsa işaretini tekrar kaldır.

## 12. Kaldırma

`legacies uninstall` bilgisayardaki tüm legacies parçalarını bulur ve listeler; onay verince kaldırır. Şunlar varsayılan olarak korunur:
- proje hafızaları (`.legacies/`),
- çalışma alanları,
- kişisel katalog.
