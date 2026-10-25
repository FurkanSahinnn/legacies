# legacies

legacies, Claude Code için projeye özel ve yalnızca bu bilgisayarda duran bir hafıza plugin'i. Üç sorunu çözüyor:

- Her yeni oturumda "önce projeyi incele" adımını tekrarlamak.
- Uzun oturumlarda sıkıştırmadan (compaction) sonra bilginin kaybolması.
- Bir oturumun, arkasında "nerede kaldık" bilgisi bırakmadan kapanması.

Hafızanın yanında **proje başına teknoloji paketleri** gelir. Kurulum projenin dillerini, framework'lerini ve veri katmanını dosyalarından tespit eder ve uygun paketleri işaretli önerir. Katalogdaki diğer paketler, uygun resmi plugin'ler ve kendi eklediğin skill'ler de aynı listede durur; hepsi sonradan açılıp kapatılabilir (bkz. [Teknoloji paketleri](#teknoloji-paketleri)).

Model çağırmıyor, kullanırken ağa bağlanmıyor (yalnız kurulum uv ve graphify'ı indirir), npm bağımlılığı yok. Windows, macOS ve Linux'ta çalışır. MIT lisanslıdır.

**Nasıl kullanılır:** Kurulumdan günlük kullanıma ve sorun gidermeye kadar adım adım anlatım için [Kullanım rehberi](docs/KULLANIM.md). Bu README başvuru belgesidir.

## Gereksinimler

| | Gerekli mi | Ne için | Kurulum |
|---|---|---|---|
| **Node.js 18+** | Zorunlu | Hook'lar, CLI ve kurulum programı | macOS: `brew install node` · Linux: [nvm](https://github.com/nvm-sh/nvm) · Windows: `winget install OpenJS.NodeJS.LTS` |
| **git** | Zorunlu | Bayatlık tespiti, `.git/info/exclude` | macOS: `xcode-select --install` · Linux: `sudo apt install git` · Windows: `winget install Git.Git` |
| **Claude Code** | Zorunlu | Plugin'in çalıştığı yer. 2.1.308 ve sonrasıyla test edildi | macOS/Linux: `curl -fsSL https://claude.ai/install.sh \| bash` · Windows: `irm https://claude.ai/install.ps1 \| iex` |
| **uv** | Kurulum programı kurar | graphify'ı (kod haritası) ve gerekirse onun Python'unu kurar | Elle gerekmez; yoksa kurulum programı sabit sürümünü (0.11.28) resmi kurucusuyla kurar |
| **graphify** | Kurulum programı kurar | Kod haritası motoru | Elle gerekmez; sabit sürümü (0.9.93) bilgisayara bir kez, legacies'in veri klasörüne kurulur (~140 MB). Senin kurduğun bir graphify'a dokunulmaz |
| **Codex CLI** | İsteğe bağlı | Codex adaptörü | Codex kuruluysa kurulum programı adaptörü önerir |

Claude Code'un plugin manifestinde gereksinim bildiren bir alan yok. Bu yüzden gereksinimleri **kurulum programı** denetler: eksik bir şey varsa hiçbir şeyi değiştirmeden durur ve bulunduğun platform için kurulum komutunu gösterir. Kurulumdan sonra da `legacies doctor` aynı kontrolleri yapar.

## Kurulum programı

Plugin'i klasörüyle birlikte bilgisayara al. Bu repo GitHub'a konunca `git clone` ile, o zamana kadar klasörü kopyalayarak. Ardından plugin klasöründe bilgisayarı hazırla (marketplace kaydı ve `legacies` komutu; hiçbir projeye kurulmaz):

```sh
# macOS / Linux
cd ~/legacies && sh install.sh

# Windows (PowerShell ya da cmd)
cd $HOME\legacies; .\install.cmd
```

Sonra her projenin klasöründe `legacies setup`: çekirdek o projeye kurulur, proje taranır ve paket seçim ekranı açılır.

`sh install.sh` klasör kopyalanırken çalıştırma izni kaybolsa da çalışır. Kurulum programı izinleri kendisi düzeltir; sonrasında `./install.sh` ve `./uninstall.sh` de çalışır.

Kurulum programı animasyonlu ve etkileşimli bir terminal arayüzüyle şu sırayla ilerler:

1. **Sistem kontrolü:** Node, git, Claude Code; isteğe bağlı olarak Codex. graphify ve uv'nin durumunu da gösterir.
2. **Mevcut kurulumun analizi:**
   - Etkin plugin'lerin hangi hook'ları kullandığına bakar. Oturum başında bağlam ekleyen ikinci bir hafıza sistemi (örneğin ECC) varsa çakışmayı ve önerilen komutu gösterir.
   - Aynı adlı skill'leri, `settings.json`'daki kendi hook'larını ve bozuk JSON'u kontrol eder.
3. **Seçenekler:**
   - **Kapsam:** yalnız bu proje (önerilen) ya da ekiple paylaşılan proje; [global kurulum yok](#kapsam-proje-bazlı). Plugin klasöründe çalışınca varsayılan "hiçbir projeye kurma"dır: yalnız hazırlık yapılır. Ok tuşlarıyla seçilir.
   - **Ek bileşenler:** kurallar, her terminalde `legacies` komutu, bu projenin Codex adaptörü, [çoklu ajan düzeni](#çoklu-ajan-düzeni) (açılırsa denge sorulur). Enter ile açılıp kapatılır; bitince listenin en altındaki **[ Onaylıyorum ]** satırında Enter'a basılır ve "Emin misiniz?" sorusuna evet denir. Hayır denirse seçimler kalır, düzenlemeye devam edilir. Kod haritası motoru graphify seçenek değildir, her kurulumda gelir (`--no-graphify` ile atlanır).
   - **Eski global kurulum:** Önceki bir sürümün global kurulumu bulunursa kaldırılması önerilir.
4. **Plan:** Yapılacakların ve **dokunulmayacakların** tam listesi. Onay vermeden hiçbir şey değişmez.
5. **Kurulum:** Her adım ayrı bir göstergeyle çalışır. Hata olursa kurulum durur; tekrar çalıştırınca tamamlanan adımlar yeniden yapılmaz.
6. **Paket seçimi:** Proje bazlı kurulumda proje taranır ve [seçim ekranı](#teknoloji-paketleri) açılır.
7. **Doğrulama ve özet:** Sıradaki adımları bir kutuda gösterir. `legacies` komutunun klasörü PATH'te değilse kabuğuna (zsh, bash, fish, PowerShell) uygun komutu kutunun altında tek satır olarak verir, böylece kopyalayıp yapıştırabilirsin.

Claude Code'un ayarları **yalnızca resmi `claude plugin ...` komutlarıyla** değiştirilir; kurulum programı `settings.json` dosyasını kendisi düzenlemez. Kurulumdan sonra plugin klasörünü silme ya da taşıma, çünkü plugin oradan yüklenir. Güncellemek için klasörü yenile (repo GitHub'a konunca `git pull`), sonra legacies kullandığın her projede bir kez `legacies setup` çalıştır: projelere kopyalanan kurallar ve graphify sürümü böyle tazelenir. Açık oturumlarda `/reload-plugins`.

Etkileşimsiz kullanım:

```sh
./install.sh --dry-run                     # yalnızca analiz ve plan; hiçbir şey değişmez
./install.sh --yes                         # plugin klasöründe: yalnız hazırlık
legacies setup --yes --scope local --packs # bir projede: çekirdek + tespit edilen paketler
legacies setup --yes --scope local --multiagent  # çoklu ajan düzeni açık
./install.sh --help
```

Plugin zaten kuruluysa `legacies setup` aynı programı açar; bileşen eklemek ya da çıkarmak için de kullanılır. Tekrar çalıştırmak güvenlidir: yapılmış adımlar atlanır, kurallar güncel sürümle yeniden yazılır, hafızaya dokunulmaz. Paket ekranında projede tespit edilip kapalı olan paketler öneri olarak işaretli gelir; bilerek kapattığın bir paket varsa işaretini kaldır.

## Kaldırma

```sh
legacies uninstall        # ya da plugin klasöründe: sh uninstall.sh  /  .\uninstall.cmd
```

Kaldırma programı önce bilgisayardaki tüm legacies parçalarını bulur ve listeler:
- plugin (her projede),
- marketplace kaydı,
- proje kuralları,
- `legacies` komutu,
- projelerdeki Codex hook'ları,
- eski sürümlerden kalan global kurallar ve Codex adaptörü,
- veri klasörü (legacies'in graphify kopyası dahil; senin kurduğun bir graphify kalır),
- çoklu ajan ayarları.

Onay verince hepsini kaldırır. Varsayılanları güvenli taraftadır:

- **Proje hafızaları (`.legacies/`) silinmez.** Hafızalar senin verindir; silmek istediklerini tek tek seçersin ya da `--delete-memories` kullanırsın. Silinince legacies'in `.git/info/exclude` dosyasına eklediği satırlar da kaldırılır.
- **Kaynak klasör silinmez.** İstersen elle silebilirsin.
- **ECC geri açılabilir.** Kurulum ECC'yi kapattıysa kaldırma onu yeniden açmayı önerir.
- **Onay sorusunun varsayılanı "hayır".** Etkileşimsiz kullanım için: `--yes`.

## Ne yapar

| Ne zaman | Ne olur |
|---|---|
| Oturum başında | Proje kartı, güncel durum, son devir kartı, not dizini ve tazelik bilgisi bütçeli olarak (≤8.000 karakter) bağlama eklenir. Bütçe dar kalırsa önce not dizini tam sığdırılır, proje kartının sonu kırpılır. |
| Her mesajda | Mesajla ilgili notlar ve olası kod konumları (≤2.500 karakter) eklenir: kod grafından `sembol — dosya:satır` (adıyla, adındaki kelimelerle ya da üstündeki doc yorumu / docstring'iyle eşleşen tanımlar), ayrıca içerik ve yol eşleşmeleri. Eşleşme zayıfsa hiçbir şey eklenmez. Aynı bilgi, bağlam yeniden başlayana kadar tekrar verilmez. Süre ~150 ms. Mesaj bir düzeltme istiyorsa ("düzelt", "fix"), önce hatayı gösteren testin yazılması hatırlatılır; bu satır hafızası olmayan projelerde de gelir. |
| Dosya düzenlenince | Değişen dosya oturum kaydına yazılır. |
| Alt ajan başlarken | Alt ajana hafızanın kısa bir özeti eklenir (≤4.000 karakter): not dizini (başlık, özet, dosya) ve proje kartı. Claude Code'un kendi yardımcı ajanlarına (`claude-code-guide`, `statusline-setup`) eklenmez. Alt ajanların araç çağrılarında korumalar ve düzenleme kaydı da çalışır. |
| Sıkıştırmadan önce | Bir kontrol noktası kaydedilir: kullanıcının son istekleri (birebir), yapılacaklar, değişen dosyalar, commit'ler ve git durumu. |
| Sıkıştırmadan sonra | Hafıza ve kontrol noktası yeniden bağlama eklenir (≤9.000 karakter). Claude'un sıkıştırma özeti de diske yazılır. |
| Tur sonunda | ≥3 dosya değiştiyse (ya da 45 dakika geçtiyse) ve güncel bir devir kartı yoksa, model **bir kez** durdurulup kartı yazması istenir. Ardından 30 dakika bekleme süresi başlar. |
| Oturum sonunda | Kart yazılmadıysa mekanik bir kart bırakılır. Eski kartlar silinmez, aynen arşive taşınır. |

`.legacies/` klasörü olmayan projelerde hook'lar hiçbir şey yapmaz. Tek istisna: git repolarında, haftada en fazla bir kez, tek satırlık bir kurulum ipucu gösterilir.

## Teknoloji paketleri

Her paket ayrı bir plugin'dir (`legacies-<paket>@legacies`) ve çekirdeğe bağlıdır. Claude Code bir plugin'in skill'lerini tek tek kapatamadığı için seçim birimi pakettir: dil, framework, veri katmanı, bulut, test, mimari, süreç ve sektör. Katalogda 75 paket, 223 resmi plugin önerisi ve senin eklediklerin var; paket listesi `catalog/registry.json` dosyasında. Paketlerin içeriği iki kaynaktan geliyor:
- 59 paket ECC'den seçilip temizlenmiş içerikten derleniyor.
- 16 paket ve 7 ek skill ECC'de hiç olmayan konular için legacies'e yazıldı (`catalog/original/`): tasarım kalıpları, DDD, CQRS/event sourcing, mikroservis, Svelte, Astro, React Router 8 (Remix), Electron, Tauri, Flask, SQLAlchemy, Symfony, SQLite, Elixir/Phoenix, Scala, Haskell, R, shell, Godot, Cypress, Go ve Rust web servisleri, EF Core. Bu skill'ler Ekim 2026'daki güncel sürümlere göre resmi dokümanlardan doğrulandı; Go, Rust ve Cypress örnekleri derlenerek denendi.

```sh
legacies packs                      # tespit + seçim ekranı (projenin klasöründe)
legacies packs suggest              # yalnız tespit sonuçları ve kanıtları
legacies packs list                 # tüm katalog; açık olanlar [x]
legacies packs on go vercel         # paket ya da resmi plugin aç
legacies packs off go               # kapat: kurulu kalır, yeniden açmak anında
legacies packs remove go            # sil: kaldırır, kurallarını çeker; önce "Emin misin?" diye sorar
legacies catalog add <klasör|git-url>   # kendi skill'lerin (tek skill, skill klasörü ya da plugin)
```

- **Tespit:** Şu dosyalar okunur: `package.json`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`/Gradle, `*.csproj`, `composer.json`, `Gemfile`, `pubspec.yaml` ve docker-compose dosyaları. İşaret dosyaları (`next.config.*`, `angular.json`…) monorepo alt klasörlerinde de bulunur. Her öneri kanıtıyla gelir (`package.json: next`). Yalnızca birkaç dosya uzantısına dayanan zayıf eşleşmeler işaretsiz önerilir. İsimden tahmin yapılmaz: bir MySQL projesine Supabase paketi önerilmez.
- **Seçim ekranı:** Tespit edilenler üstte ve işaretli gelir. Diğer paketler, kendi eklediklerin ve resmi plugin'ler gruplar halinde altta durur. `a` tuşu imlecin bulunduğu grubun tamamını seçer ya da temizler.
- **Resmi plugin'ler:** Yalnızca sürpriz yaratmayanlar önceden işaretlenir. Hook ya da MCP sunucusu getirenler ve içeriği yerelde doğrulanamayanlar notuyla birlikte işaretsiz gelir. Dil sunucusu plugin'leri, sunucusu PATH'teyse işaretlenir.
- **Kapsam:** Varsayılan `local`: yalnız bu projede, yalnız bu bilgisayarda (`.claude/settings.local.json`). Ekiple paylaşmak için `--scope project`.
- **Kurallar:** Plugin'ler kural taşıyamadığı için paketlerin kuralları projenin `.claude/rules/` klasörüne `legacies-*.md` adlarıyla kopyalanır. `local` kapsamda bu dosyalar git'ten gizlenir. Paket kapanınca kuralları da silinir.
- **Kendi skill'lerin:** `legacies catalog add` onları bu bilgisayardaki kişisel kataloğa koyar (`~/.claude/legacies-catalog`, marketplace adı `legacies-personal`). Git kaynakları eklendikleri commit'e sabitlenir. Ardından paketler gibi proje başına açılırlar. `legacies uninstall` kişisel kataloğa dokunmaz.
- **Claude Code içinde:** `/legacies:packs` önerileri gösterir, seçimi sana sorar ve uygular. `/plugin` ekranı da paketleri listeler. Değişikliği açık oturuma yüklemek için `/reload-plugins`.

## Birden çok proje

Bir terminalden başka bir repoya bakmak ya da bir projeyi diğerine taşımak (örneğin web client'tan mobil uygulamaya) için üç kademe var.

**1. Oturuma proje eklemek (`/add-dir`):**
- **Eklenen projenin özeti:** Claude Code'da `/add-dir <klasör>` dediğinde, o projenin kartı, güncel durumu ve not dizini kısaca bir sonraki tura eklenir.
- **İlgili notlar:** Sonraki mesajlarda o projenin ilgili notları da kendi etiketiyle gelir (`[mobil · gotcha] …`).
- **Düzenlemelerin kaydı:** Hangi projenin dosyasını düzenlersen, düzenleme o projenin kaydına yazılır. Bitirirken hatırlatma her proje için ayrı kart ister (`legacies handoff --project <klasör>`). Kart yazılmazsa oturum sonunda o projeye mekanik bir kart bırakılır.
- **`/cd` ile geçmek:** Oturum `/cd` ile başka bir projeye geçerse, o projenin başlangıç bağlamı ilk mesajda bir kez verilir.
- **Ortak arama:** `legacies search "<terimler>" --all`, oturumun bütün projelerinde ve çalışma alanlarında arar.

**2. Çalışma alanı:** Birlikte çalışılan projeleri adlandırılmış bir grupta toplar.

```sh
legacies workspace add hobigate D:\Workspace\hobigate-web D:\Workspace\hobigate-mobile
legacies open hobigate        # Claude Code'u bir üyede açar, diğerlerini --add-dir ile ekler
legacies add --workspace hobigate --type decision --title "Web ve mobil aynı token formatını kullanır" --text "..."
```

- **Ortak hafıza:** Projeler arası kararlar (API sözleşmesi, ortak kurallar, eşleme tabloları) çalışma alanının ortak hafızasında durur: `~/.claude/legacies-workspaces/<ad>/`.
- **Neden orada:**
  - Hiçbir reponun içinde değil, çünkü böyle bir kararın sahibi tek bir proje olamaz.
  - Projelerin `.legacies/` klasörleri gibi yalnız bu bilgisayarda durur.
  - `legacies uninstall` ona dokunmaz.
- **Oturum başı:** Çalışma alanındaki bir projede açılan oturuma üyelerin listesi, ortak not dizini ve göçlerin durumu eklenir.

**3. Göç yardımcısı:**

```sh
legacies migrate start web-mobil --from D:\Workspace\hobigate-web --to D:\Workspace\hobigate-mobile
legacies migrate next web-mobil          # sıradaki maddeler
legacies migrate done web-mobil route:settings/profile --note "form doğrulaması eklendi"
legacies migrate status
```

- **Envanter:** Kaynak projedeki sayfalar ve rotalar, ekranlar, API uçları, bileşenler, hook'lar, durum yönetimi ve servisler çıkarılır. Next.js app/pages, Expo Router, SvelteKit, Nuxt, React Navigation ve Flutter adlandırmaları tanınır.
- **Eşleştirme:** Her madde hedef projede var olanla eşleştirilir: aynı rota (`exact`), aynı ad (`name`, kontrol gerekir) ya da karşılığı yok.
- **Kayıt:** Liste çalışma alanının `migrations/` klasöründe hem JSON hem Markdown olarak durur ve oturum başında özetlenir.
- **Yenileme:** `refresh`, kaynak değiştikçe durumları koruyarak listeyi tazeler.
- **Claude Code içinde:** `/legacies:migrate` maddeleri sırayla taşıtır, doğrulatır ve işaretletir.

Envanter sezgiseldir; bir başlangıç listesidir, her madde taşınmadan önce değerlendirilir.

## Ölçüm

```sh
claude plugin eval . --scaffold --trust-plugin --no-publish     # çekirdek: hafıza katkısı ve skill tetiklenmesi
claude plugin eval . --eval-dir packs/postgres/pack-evals --trust-plugin --no-publish
                                                                # bir paketin içeriği ve tetiklenmesi (paket + çekirdek
                                                                # birlikte yüklenir; kökten çalıştırılır)
npm run bench:hooks                                             # hook gecikmeleri
```

- **Değerlendirme durumları:**
  - Çekirdeğin durumları `evals/`, paketlerinki `catalog/pack-evals/<paket>/` altında. Derleme paket durumlarını paketin içine kopyalar.
  - Her durum plugin'li ve plugin'siz çalışır; fark (`Δ`), plugin'in katkısını gösterir.
- **Maliyet:** Değerlendirme gerçek model çağrısı yapar ve hesabından düşer. Bütçe için `--max-cost-usd` kullan.
- **Windows:** Bash izni gerektiren durumlar ancak WSL2'de çalışır; buradaki durumlar bu yüzden Bash istemez.

## Kapsam: proje bazlı

legacies yalnızca kurulduğu projelerde çalışır; global kurulum yoktur. Her proje çekirdeği ve kendi teknolojilerine uyan paketleri alır; legacies'i kullanmayan projeler bağlam harcamaz. Hafıza da proje başınadır: her projenin kendi `.legacies/` klasörü olur.

Kapsamı kurulum programı sorar. Elle yapmak istersen önce marketplace'i bir kez ekle: `claude plugin marketplace add <plugin klasörü>`. Sonra proje klasöründe:

| Nasıl | Komut | Nerede etkin | Repo değişir mi? |
|---|---|---|---|
| **Yalnız bu bilgisayarda** (önerilen) | `claude plugin install legacies@legacies --scope local` | O projede, yalnız bu bilgisayarda | Hayır; `.claude/settings.local.json` git'e girmez |
| **Ekiple paylaşılan** | `claude plugin install legacies@legacies --scope project` | O projeyi açan herkes | Evet; `.claude/settings.json` commit'lenir |

**Notlar:**
- **Claude Code'u projenin kök klasöründe aç.** Claude Code proje ayarlarını açıldığı klasörden okur. Alt ya da üst bir klasörde açılan oturum, o projenin kurulumunu görmez.
- **Bilgisayar düzeyinde kalanlar:** marketplace kaydı, terminaldeki `legacies` komutu ve graphify. Hiçbiri bir oturuma bağlam eklemez.
  - graphify kod haritasını çıkaran programdır. Bir kez kurulur (~140 MB, `~/.claude/plugins/data/legacies-legacies/graphify/`) ve yalnız legacies kurulu projelerde çalıştırılır.
  - Marketplace kaydı paketlerin kaynağıdır. Silinirse ondan kurulan her plugin de kalkar.
  - `legacies` komutu yeni bir projeyi kurmak (`legacies setup`) ve Codex'in komutları çalıştırabilmesi için gerekir.
- **Hafızası olmayan bir projede:** legacies yalnızca güvenlik korumalarını çalıştırır. Git repolarında haftada en fazla bir kez tek satırlık bir kurulum ipucu da gösterir. Hafıza enjeksiyonu `/legacies:onboard` sonrasında başlar.
- **Eski global kurulum:** Önceki sürümler legacies'i her projeye kurabiliyordu. `legacies setup` böyle bir kurulum bulursa üç parçasını kaldırmayı önerir:
  - kullanıcı kapsamındaki plugin (`--keep-data` ile; plugin verisi proje kurulumlarıyla ortak),
  - `~/.claude/rules` altındaki legacies kuralları,
  - Codex'in global adaptörü.

  Kaldırma proje kurulumundan sonra yapılır ve hafızalara dokunmaz. Bırakmak için `--keep-global` ver. legacies'i kullandığın diğer projelerde de bir kez `legacies setup` çalıştır.
- **Ekiple paylaşım:** `--scope project` başka bilgisayarlarda çalışsın diye marketplace'in herkesin erişebileceği bir yerde olması gerekir, örneğin bu repo GitHub'a konunca `claude plugin marketplace add <kullanıcı>/<repo>`. Şu anki yerel klasör yolu yalnızca bu bilgisayarda geçerlidir.
- **Değişiklikleri yüklemek:** Ardından Claude Code'u yeniden başlat ya da `/reload-plugins` çalıştır. Plugin klasörden doğrudan yüklendiği için kod değişiklikleri sürüm artırmadan devreye girer.

## Bir projede kullanmak

1. Projenin kök klasöründe Claude Code'u aç ve `/legacies:onboard` çalıştır. Proje bir kez incelenip kaydedilir.
2. Bundan sonra her oturum bu hafızayla başlar.

Repodaki hiçbir dosya değişmez: `.legacies/` klasörü, commit'lenen `.gitignore` yerine `.git/info/exclude` dosyasıyla gizlenir.

Hangi cümlenin hangi skill'i açtığı, kendiliğinden olanlar ve tüm skill'ler: [Kullanım rehberi](docs/KULLANIM.md), 3. ve 4. bölümler.

## Kalite katmanı (ECC'den seçilip uyarlandı)

Çekirdekte yalnızca her projede işe yarayanlar kaldı. Teknolojiye özel olanlar paketlere taşındı:
- React skill'leri ve `react-reviewer`: **react** paketi.
- `postgres-patterns` ve `database-reviewer`: **postgres** paketi. `database-migrations`: **db-migrations** paketi.
- `typescript-reviewer` ve `build-error-resolver`: **typescript** paketi.
- `security-review` ve `security-reviewer`: **security** paketi. Bu paket her projede önerilir.
- `error-handling`: **coding-standards** paketi. `e2e-testing`: **testing-e2e** paketi.

Süreç skill'leri [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)'ten (MIT) uyarlandı ve legacies'in hafızasına bağlandı. Kaynaklar `THIRD_PARTY_NOTICES.md` dosyasında.

**Skill'ler** (model gerektiğinde kendisi kullanır):

| Skill | Ne için |
|---|---|
| `tdd-workflow` | Önce test, sonra kod: ince dilimlerle, her dilim RED → GREEN kanıtıyla. Hata düzeltirken önce hatayı gösteren test |
| `debugging` | Bir şey bozulunca kök nedeni bulmak: yeniden üret, yerini daralt, küçült, nedeni düzelt, regresyon testiyle koru |
| `verification-loop` | Bitti demeden önce derleme, tip kontrolü, lint, test, sır taraması ve diff kontrolü. Çıktı kırpılmaz |
| `search-first` | Yeni bir şey yazmadan önce repoda, legacies hafızasında ve paket kayıtlarında var olanı aramak; framework kodu için kullanılan sürümün resmi belgesine bakmak |
| `packs` | Bu projenin paketlerini göstermek, önermek ve sorarak açıp kapatmak |

**İş akışları** (yalnızca sen çağırırsın, bağlama yük getirmez):

| Komut | Ne yapar |
|---|---|
| `/legacies:spec` | Ne yapılacağını tek tek sorularla netleştirir, kısa bir spec yazar (`.legacies/specs/`), **onay bekler**. Sonraki adım `/legacies:plan` |
| `/legacies:plan` | Gereksinimi ve riskleri çıkarır, kodu ve hafızayı tarayarak işi kabul kriterli küçük görevlere ve kontrol noktalarına böler (`.legacies/plans/`), **onay bekler** |
| `/legacies:review-pr` | PR'ı (`gh`) ya da yerel diff'i dosya türüne göre uzman reviewer'lara dağıtır ve yalnızca ≥%80 güvenli bulguları raporlar |

**Alt ajanlar** (`legacies:<ad>`): code-reviewer (genel inceleme; diğer alanları uzmanına yönlendirir), silent-failure-hunter, type-design-analyzer. Uzman inceleyiciler paketlerle gelir (`legacies-typescript:typescript-reviewer`, `legacies-react:react-reviewer`, `legacies-go:go-reviewer`…). Projede bir alanın uzmanı yoksa o alana `code-reviewer` bakar. Her alanın tek bir sahibi var, böylece aynı bulgu iki kez raporlanmaz. Ajanlar ana modeli kullanır.

## Dosyalar

```
<proje>/.legacies/              git'e girmez
├── PROJECT.md                  proje kartı (≤150 satır)
├── STATE.md                    güncel odak ve açık işler
├── memory/
│   ├── INDEX.md                üretilen dizin
│   └── decision|gotcha|convention|howto|reference/*.md
├── sessions/                   devir kartları; eskileri archive/ altında
└── state/                      oturum kayıtları ve kontrol noktaları (14 gün sonra silinir)
```

Bir not şöyle görünür:

```markdown
---
title: Server component'lerde createServerClient kullanılmalı
type: gotcha
summary: RSC içinde tarayıcı istemcisi oturumu kaybeder
paths: [src/lib/supabase/**, src/middleware.ts]
verified: 2026-10-22@8e64b2c8
status: active
---
Neden doğru olduğu, nerede yaşadığı ve nasıl doğrulanacağı.
```

`verified` alanında notun doğrulandığı commit tutulur. O commit'ten sonra `paths` altındaki dosyalar değişirse not, bağlamda **"⚠ doğrulanmalı"** işaretiyle gelir. Notu kodla karşılaştırıp düzelttikten sonra `legacies verify <dosya>` ile işareti kaldırabilirsin.

## CLI

Plugin etkinken `legacies` komutu Bash aracının PATH'inde bulunur.

| Komut | Ne yapar |
|---|---|
| `legacies init` | Yapıyı kurar (idempotent) |
| `legacies context` | Oturum başı bağlamını yazdırır; diğer AI'lar için |
| `legacies search "<terimler>"` | Notlarda, PROJECT/STATE'te ve devir kartlarında arar |
| `legacies add --type gotcha --title "..." --paths "src/**"` | Not ekler; gövde stdin, `--text` ya da `--file` ile verilir |
| `legacies handoff` | Bu oturumun kartını yazar. `--skip "<neden>"` kartı bilerek atlar |
| `legacies verify <dosya>` | Notu bugünün tarihi ve HEAD ile doğrulanmış işaretler |
| `legacies stale` | Kodu değişmiş notları listeler |
| `legacies index` | Dizini yeniden üretir |
| `legacies map "<soru>"` | İlgili sembolleri (`dosya:satır`) ve dosyaları bulur. `--deep` ekleyince bulunan sembollerin en yakın çağıranları ve çağırdıkları da gelir |
| `legacies vocab [kelime...]` | Projenin kod kelimelerini listeler (başka dildeki soruyu çevirmek için). Kelime verilirse projede hangilerinin geçtiğini gösterir |
| `legacies graph status\|build\|update` | Kod grafını yönetir (yalnız AST, LLM yok; `build --background` arka planda) |
| `legacies graph explain\|path\|affected "<ad>"` | Bir sembolün bağlantıları, iki sembol arası yol, neyi etkilediği. Aynı adlı semboller satırlarıyla listelenir; biri `"dosya::Ad"` ile seçilir. Çıktı ~2.000 karakterle sınırlı |
| `legacies packs` | Bu projenin teknoloji paketleri: tespit, seçim ekranı, `suggest`, `list`, `add`, `remove` |
| `legacies catalog add\|list\|remove` | Kendi skill'lerini kişisel kataloğa ekler; projelerde paket gibi açılır |
| `legacies multiagent` | Çoklu ajan düzeni: ayar ekranı, `on`/`off`, `set`, `role`, `reset`, `status`; `default` ile bilgisayar varsayılanı |
| `legacies doctor` | Sağlık kontrolü yapar |

**Arama nasıl çalışıyor:**
- camelCase, snake_case ve yolları böler (`getUserSession` → `get user session`).
- Türkçe harfleri sadeleştirir.
- Kök ayırıcı yerine önek eşleşmesi kullanır (`doğrulamayı` → `doğrulama`). Böylece İngilizce kod terimleri bozulmaz.

## Kod grafı: graphify

[graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0) legacies'in kod haritası motorudur. Kodu tree-sitter ile yerelde ayrıştırır; sembolleri, import'ları ve çağrıları bir grafa yazar. LLM çağrılmaz.

- **Nasıl kurulur:** `legacies setup`, graphify'ın test edilmiş sürümünü (0.9.93) uv ile legacies'in kendi veri klasörüne kurar; sorulmaz. uv yoksa önce onu kurar, Python yoksa uv getirir.
- **Senin graphify'ın:** Kendi kurduğun bir graphify varsa ona dokunulmaz. legacies yalnız kendi kopyasını çalıştırır, kaldırırken de yalnız onu siler.
- **graphify'ın kendi kurulumu çalışmaz:** CLAUDE.md'ye blok, araç çağrılarına hook ya da ajan klasörlerine skill eklenmez. legacies yalnız `extract . --code-only` ve `update .` komutlarını çalıştırır; LLM, ipuçları, reklam ve sorgu günlüğü kapalıdır.
- **Graf ne zaman oluşur:** Hafızası olan bir projede graf yoksa oturum başında arka planda kurulur. Onboard da kurulumu hemen başlatır.
- **Nereye yazılır:** `.legacies/graph/` klasörüne; projede `graphify-out/` oluşmaz. Bu klasör zaten git'ten gizli.
- **Nasıl güncel kalır:** Dosya düzenlenen turların sonunda ve graf HEAD'in gerisinde kaldığında legacies `graphify update .` komutunu arka planda başlatır. Oturum hiç beklemez.
- **Kurulu değilse:** Yalnız yol ve içerik eşleşmesi çalışır.

legacies'in graphify'ın üstüne ekledikleri:
- **Hızlı ve sınırlı sorgu:** graphify her soruda haritayı Python'da baştan yükler (~0,9–1,2 sn); cevapları bütçeyi 4–6 kat aşabilir. `legacies graph explain|path|affected` ve `map --deep`, haritanın sıkıştırılmış bir kopyasından Node'da cevaplanır: ~0,13 sn, en fazla ~2.000 karakter. 30 sembolde bulunan bağlantılar graphify'ınkilerle birebir aynı.
- **Aynı adlı tip ve fonksiyon:** graphify'ın kimlikleri büyük-küçük harfi yok saydığı için `FieldRevertConfig` tipi ile `fieldRevertConfig` fonksiyonu tek düğüm oluyordu. Aranan adın harfleri farklıysa legacies tanımı dosyada bulup doğru satırı gösterir.
- **İçerik eşleşmesi (her dilde):** Sorular genelde kodun ne yaptığını anlatır, örneğin "parası yetmeyince sandık açmayı reddeden yer". Bu kelimeler kodun içinde geçer: tanımlayıcılar, hata kodları, tablo adları, yorumlar. graphify yalnız sembol adlarına bakıyordu. legacies her kod dosyasını (Python, Go, Java, C#, Ruby, PHP, Rust, TS/JS ve diğerleri) yoluyla ve içindeki kelimelerle eşler. Bunun için framework'e özgü bir kural gerekmez. Next.js, SvelteKit ve Expo Router rotaları ayrıca `POST /api/chest/open` gibi bir etiket alır.
- **Başka dilde sorular (graphify'daki gibi model çevirir):** Elle yazılmış bir sözlük yok; her dili sözlükle karşılamak mümkün değil. `legacies vocab` projenin kod kelimelerini listeler: sembol adlarındaki ve klasör/dosya adlarındaki kelimeler, en çok kullanılandan aza, en fazla 300 (graf yoksa dosyaların içindeki kelimeler). Model sorunun anlamına uyanları seçip `legacies map` ile arar. `legacies vocab chest crate` gibi kelime verilince projede hangilerinin geçtiğini gösterir; tahmin edilen çeviri böyle doğrulanır.
- **Projenin kendi çeviri dosyaları:** Otomatik öneri, Türkçe sorularda projenin çeviri dosyalarını da kullanır: JSON/ARB, YAML, gettext (.po), Java .properties, Android `strings.xml`, iOS `.strings`, .NET `.resx`. Aynı anahtarda birlikte geçen kelimeler eşlenir; `legacies map` eklediği kelimeleri `(Sözlük: ...)` satırında gösterir.

## Çoklu ajan düzeni

Claude büyük bir işi parçalara bölüp alt ajanlara verebilir. Çoklu ajan düzeni açıkken legacies her oturumun başında lidere (ana oturuma) kısa bir kural verir:
- hangi ajana hangi modeli ve effort'u vereceği,
- küçük işlerde (tek dosya, birkaç satır, belge ya da ayar, kısa soru) ajan açmayıp işi kendisinin yapacağı,
- aynı anda en fazla kaç ajan çalıştıracağı; bağımsız işleri paralel, bağımlı olanları sırayla vereceği,
- yazan ajanların dosyalarını ayıracağı (gerekirse ayrı worktree), paket tanımı ve kilit dosyalarını yalnız kendisinin değiştireceği,
- başarısız bir işi nasıl yeniden deneyeceği,
- ajanın sonucunu kendisinin doğrulayıp sonunda hangi işi hangi ajanın yaptığını ve nasıl doğrulandığını özetleyeceği.

Bu kuralların bir kısmı [ruflo](https://github.com/ruvnet/ruflo) ve ECC'nin orkestrasyon kurallarından alındı; ikisinin de her oturuma binlerce token ekleyen sabit ajan hatları ve araçları alınmadı.

Effort, modelin cevap vermeden önce ne kadar düşündüğüdür (low, medium, high, xhigh, max). Lider bunları her ajanı başlatırken Agent aracına verir; ajan dosyalarına dokunulmaz.

- **Varsayılan olarak kapalı.** Kapalıyken hiçbir şey eklenmez. Açıkken her oturuma ~400 token eklenir; yalnız lidere ve yalnız Claude Code'da.
- **Açıp kapatmak:** Kurulumda "Ek bileşenler" listesinden ya da sonradan `legacies multiagent on` / `off` ile. Kapatmak hiçbir şeyi silmez; yeniden açınca son ayarlarla gelir. Değişiklik yeni oturumda geçerli olur.
- **Üç hazır denge ve Özel:** "Özel"de her rolün modelini ve effort'unu sen seçersin.

  | Rol | Dengeli | Kalite | Maliyet |
  |---|---|---|---|
  | İnceleme | senin modelin · high | senin modelin · high | Sonnet · high |
  | Tasarım ve teşhis | senin modelin · high | senin modelin · high | Sonnet · high |
  | Uygulama | Sonnet · medium | senin modelin · high | Sonnet · low |
  | Arama | Haiku · low | Haiku · low | Haiku · low |

- **Roller:**
  - İnceleme: adı `-reviewer` ya da `-analyzer` ile bitenler ve `silent-failure-hunter`.
  - Tasarım ve teşhis: `Plan`, adı `architect` ile bitenler, `type-design-analyzer`, `network-troubleshooter`, `spec-miner`, `performance-optimizer`.
  - Arama: `Explore` ve adı `-lookup` ile bitenler.
  - Uygulama: geri kalanların hepsi, `general-purpose` dahil.

  Bir ajanı başka bir role alabilirsin; kendi ajanların da buna dahil.
- **Diğer ayarlar:** aynı anda en fazla kaç ajan (1–8, varsayılan 4) ve başarısız olan işin bir üst effort'la yeniden denenmesi (varsayılan açık).
- **Ayar ekranı:** terminalde `legacies multiagent`. Satırı Enter'la değiştir, en alttaki **[ Onaylıyorum ]** ile kaydet.
- **Komutlar:**

  ```sh
  legacies multiagent on [dengeli|kalite|maliyet|ozel]   # aç (denge vermezsen son seçilen)
  legacies multiagent off                                # kapat
  legacies multiagent set uygulama opus high             # bir rolün modeli ve effort'u (denge "Özel" olur)
  legacies multiagent set paralel 3                      # aynı anda en fazla 3 ajan
  legacies multiagent set yukselt off                    # yeniden deneme kuralını kapat
  legacies multiagent role architect uygulama            # ajanı başka role al (geri: ... varsayilan)
  legacies multiagent reset                              # bu projenin ayarlarını sil, varsayılana dön
  legacies multiagent status                             # durum
  ```

  Model değerleri `inherit` (senin modelin), `opus`, `sonnet`, `haiku`. Claude'a "çoklu ajanı maliyet moduna al" demek de yeter.
- **Bilgisayar varsayılanı:** Komutun başına `default` eklersen (`legacies multiagent default on maliyet`) bu bilgisayardaki tüm projelerin varsayılanını değiştirirsin. Kendi ayarı olan proje kendi ayarını kullanır. Kurulum programı plugin klasöründe çalışınca seçim varsayılana yazılır. Ayarlar `~/.claude/legacies-multiagent.json` dosyasında, yalnız bu bilgisayarda durur.
- **Ajan takımları:** Claude Code'un deneysel "agent teams" özelliğini legacies açmaz; bu Claude Code'un kendi ayarıdır (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Açıksa aynı kurallar takım arkadaşlarını başlatırken de geçerlidir.

## Güvenlik korumaları

Bu korumalar `.legacies/` olsun ya da olmasın her projede çalışır ve ECC'nin koruyucu hook'larının yerini alır.

| Koruma | Ne yapar | Kapatmak için |
|---|---|---|
| Git hook'larını atlama | `--no-verify` (ve kısaltmaları), `commit -n`, `core.hooksPath` değiştirme, `HUSKY=0` → **reddedilir** | `LEGACIES_GUARD_NOVERIFY=off` |
| Sır taraması | Yazılan içerikte AWS/GitHub/OpenAI/Anthropic/Stripe/Slack/Google anahtarı, özel anahtar, Supabase `service_role` JWT'si ya da şifreli veritabanı adresi varsa **reddedilir**. `.env*` dosyalarına izin verilir. Yerel geliştirme adresleri (`postgres:postgres@localhost`) ve anon anahtarı serbesttir | `LEGACIES_GUARD_SECRETS=off` |
| Lint/format ayarı | Mevcut eslint, prettier, biome, ruff, mypy veya stylelint ayarı düzenlenecekse **sana sorulur**. Amaç, kodu düzeltmek yerine kontrolü gevşetmeyi engellemek | `LEGACIES_GUARD_CONFIG=off` |

Hepsini birden kapatmak için: `LEGACIES_GUARDS=off`.

## Kodlama kuralları

Plugin'ler kural dosyası taşıyamadığı için kuralları kurulum programı projeye kopyalar. Elle:

```sh
legacies rules status      # her kuralın kapsamını ve her oturuma eklenen maliyeti gösterir
legacies rules install     # bu projenin .claude/rules/ klasörüne legacies-*.md adlarıyla kurar, git'ten gizler
legacies rules uninstall   # yalnız legacies'in kurduklarını kaldırır
```

Kuralların neredeyse tamamı **dosya türüne bağlıdır**: TypeScript kuralları yalnızca `.ts`/`.tsx` dosyası okunduğunda yüklenir. Her oturuma eklenen kapsamsız kısım birkaç KB ile sınırlıdır.

## Codex ve diğer AI'lar

Hafıza düz Markdown olduğu için her AI okuyabilir. Codex adaptörü de proje başınadır. `legacies setup` Codex'i bulursa adaptörü kendisi kurar. Elle, projenin klasöründe:

```sh
legacies codex install
legacies codex status
legacies codex uninstall
```

`install`, projenin `.codex/hooks.json` dosyasına aynı motoru çağıran hook'ları ekler: oturum başı bağlamı, mesaj başı getirme, düzenleme kaydı, sıkıştırma öncesi kontrol noktası ve devir kartı hatırlatması.
- Oturum başı bağlamı, hafıza komutlarının nasıl kullanılacağını da anlatır.
- Dosyadaki diğer hook'lar korunur ve dosya git'ten gizlenir.
- Git'te takip edilen bir `hooks.json` hiç değiştirilmez.

Codex proje hook'larını yalnızca güvendiği projelerde yükler. Projeye güvendikten sonra her hook'u `/hooks` ekranında onaylaman gerekir. Codex'in hafıza komutlarını (`legacies search`, `legacies handoff` …) çalıştırabilmesi için `legacies` komutunun PATH'te olması gerekir; kurulum programı onu `~/.local/bin` altına koyar.

Hook'u olmayan bir AI, oturum başında `legacies context` çalıştırarak aynı bağlamı alır.

## Ayarlar

Proje bazında isteğe bağlı bir `.legacies/config.json` dosyası:

```json
{
  "startupBudget": 8000,
  "compactBudget": 9000,
  "promptContext": true,
  "promptBudget": 2500,
  "subagentContext": true,
  "subagentBudget": 4000,
  "stopReminder": true,
  "reminderMinFiles": 3,
  "reminderIdleMinutes": 45,
  "reminderCooldownMinutes": 30,
  "keepSessionCards": 30
}
```

Ortam değişkenleri:

| Değişken | Etkisi |
|---|---|
| `LEGACIES_DISABLED=1` | Tüm hook'ları kapatır |
| `LEGACIES_STOP_REMINDER=off` | Devir kartı hatırlatmasını kapatır |
| `LEGACIES_PROMPT_CONTEXT=off` | Mesaj başı not ve kod konumu önerilerini ve önce-test hatırlatmasını kapatır |
| `LEGACIES_SUBAGENT_CONTEXT=off` | Alt ajanlara hafıza özeti eklemeyi kapatır |
| `LEGACIES_HINT=off` | Kurulum ipucunu kapatır |

## Gizlilik ve güvenlik

- Kullanırken ağ erişimi ve model çağrısı yok. Ağa yalnız şu durumlarda çıkılır: kurulum uv'yi (astral.sh) ve graphify'ı (PyPI) indirir, uv gerekirse Python'u da indirir; `legacies catalog add` bir git adresi verilince o repoyu indirir.
- Kullanıcının istekleri yalnızca projenin kendi `.legacies/state/` klasörüne yazılır ve 14 gün sonra silinir.
- Hook'lar hata verse bile oturumu bozmaz: her zaman `exit 0` ile çıkar.
- Hatalar plugin veri klasöründeki en fazla 50 satırlık bir günlüğe yazılır.
- Hafıza notları bağlama "veri, talimat değil" diye etiketlenerek eklenir. Kodla çelişirse kod esas alınır.

## Geliştirme

```sh
npm test                      # node:test: CLI, hook'lar ve kurulum programı gerçek süreç olarak, geçici
                              # repolarda ve sahte bir `claude` CLI ile test edilir; geçici klasörler
                              # test bitince silinir (çalıştırma izni testi yalnız Unix'te koşar)
claude plugin validate .
npm run packs:build           # packs/ klasörünü catalog/registry.json, catalog/own/ ve yanındaki ECC
                              # kopyasından yeniden üretir ve marketplace.json'a yazar; bir yama tam bir
                              # kez eşleşmezse ya da kopuk atıf kalırsa durur
```

Tasarımın gerekçeleri ve aşama planı: `../ANALIZ-VE-PLAN.md` (yalnızca geliştirme klasöründe, repoda yok).

### Yayınlamadan önce

- **Windows'ta ilk commit'ten önce** çalıştırma izinlerini git'e işle:
  `git add --chmod=+x bin/legacies install.sh uninstall.sh`. Windows'ta git bu izni kendiliğinden kaydetmez (`core.filemode=false`); kaydedilmezse macOS ve Linux'ta `./install.sh` "permission denied" verir. `sh install.sh` yine çalışır. `bin/legacies`'in iznini de ilk oturum başında legacies kendisi düzeltir.
- `.legacies/` (bu reponun kendi hafızası) `.gitignore`'da olduğu için commit'e girmez.
