# fal.ai Image Studio (Cloudflare Worker)

Kevyt, bearer-tokenilla suojattu web-työkalu projektikohtaisten kuvien generointiin
fal.ai:lla (artikkelit, blogit, some). FAL_KEY pysyy palvelimella — ei koskaan selaimeen.

## Sijainti ja ympäristö

| | |
|---|---|
| Paikallinen polku | `/Users/henrikkikellberg/Documents/Claude/Projects/AI content generator/fal-image-studio` |
| GitHub-tili | `henrikkikellberg-lgtm` (repo luotu) |
| Cloudflare-subdomain | `henrikki-kellberg.workers.dev` |
| Worker-nimi | `fal-image-studio` (uniikki; tilillä useita muita workereita) |
| Tuotanto-URL | `https://fal-image-studio.henrikki-kellberg.workers.dev` |
| Deploy | GitHub Actions (`git push` main-haaraan) |

## Miten toimii

- `GET /` — käyttöliittymä: prompti, kuvasuhde (16:9 / 1:1 / 9:16 / 4:3 / 3:4), malli.
- `POST /api/generate` — tarkistaa `Authorization: Bearer <UI_TOKEN>`, kutsuu fal.ai:ta `FAL_KEY`:llä, palauttaa kuvan URLin.
- `GET /api/download?url=…&t=<UI_TOKEN>` — lataa kuvan palvelimen kautta (pakotettu tallennus; kiertää fal-CDN:n vanhenevat linkit).

## Deploy — GitHub Actions (suositeltu, = git push)

Peilaa op-fund-trackerin mallia. Deploy tapahtuu joka pushissa `main`-haaraan;
`.github/workflows/deploy.yml` synkkaa myös `FAL_KEY`- ja `UI_TOKEN`-secretit
Workeriin automaattisesti — sinun ei tarvitse ajaa `wrangler secret put` käsin.

**Kertaluontoinen setup:**

1. Repo-juuri = `fal-image-studio/`. Repo on jo luotu GitHubiin tilille
   **henrikkikellberg-lgtm**. Kytke ja pushaa (vaihda repo-nimi jos eri):
   ```bash
   cd "/Users/henrikkikellberg/Documents/Claude/Projects/AI content generator/fal-image-studio"
   git init && git add . && git commit -m "v1.0.0: fal image studio"
   git branch -M main
   git remote add origin git@github.com:henrikkikellberg-lgtm/fal-image-studio.git
   git push -u origin main
   ```

2. Lisää GitHubissa **Settings → Secrets and variables → Actions** kolme secretiä:
   | Secret | Arvo |
   |---|---|
   | `CF_API_TOKEN` | Cloudflare API-token (sama tyyppi kuin op-fund-trackerissa; Workers-deploy-oikeudet) |
   | `FAL_KEY` | fal.ai-avain |
   | `UI_TOKEN` | oma pitkä token (esim. `openssl rand -hex 24`) |

3. Push (tai aja workflow käsin GitHubin Actions-välilehdeltä) → Actions ajaa
   `wrangler deploy` ja pushaa secretit. Valmis Worker:
   `https://fal-image-studio.henrikki-kellberg.workers.dev`.

Jatkossa: `git push` = deploy. Avaa URL selaimessa, syötä sama `UI_TOKEN`
(tallentuu selaimeen), kirjoita prompti → Generoi.

> **CF_API_TOKEN:** jos haluat käyttää samaa tokenia kuin op-fund-trackerissa,
> se löytyy jo sen repon GitHub-secreteistä — luo fal-image-studiolle vain oma
> kopio samasta arvosta (GitHub-secretit eivät jaa reposta toiseen).

## Vaihtoehto — manuaali (wrangler paikallisesti)

```bash
cd "AI content generator/fal-image-studio"
npx wrangler login
npx wrangler secret put FAL_KEY
npx wrangler secret put UI_TOKEN
npx wrangler deploy
```

## Paikallinen testaus

```bash
npx wrangler dev
# .dev.vars-tiedostoon paikalliset arvot:
#   FAL_KEY=xxx
#   UI_TOKEN=testi123
```

## Mallit

| Malli | Hinta/kuva | Parametri | Käyttö |
|---|---|---|---|
| `fal-ai/nano-banana-pro` | ~0,15 $ | `aspect_ratio` + `resolution` | **paras laatu** (Gemini 3 Pro Image), paras tekstinrenderöinti, julkaisuun |
| `fal-ai/flux-pro/v1.1` | ~0,04 $ | `image_size` | flux-perheen paras |
| `fal-ai/nano-banana` | ~0,04 $ | `aspect_ratio` | nopeampi/halvempi Gemini |
| `fal-ai/flux/dev` | ~0,025 $ | `image_size` | tasapaino |
| `fal-ai/flux/schnell` | ~0,003 $ | `image_size` | nopea vedos, oletus |

**Parametriadapteri (`buildFalBody` `src/index.js`:ssä):** flux-mallit saavat
`image_size`:n (mapattu kuvasuhteesta), nano-banana-perhe saa `aspect_ratio`:n
suoraan (`16:9`,`1:1`,`9:16`,`4:3`,`3:4`). nano-banana-pro lisää `resolution:"2K"`
(1K/2K/4K; 4K = tuplahinta). Uuden mallin lisäys: täydennä `MODELS` + tarvittaessa
`buildFalBody`.

> **Huom nano-banana-pro:** kaikkiin kuviin tulee SynthID-digitaalivesileima ja
> näkyvä vesileima ei-Ultra-tilauksilla. Tarkista fal-tilisi taso jos näkyvä
> vesileima haittaa.

## Turvallisuus

- `FAL_KEY` ja `UI_TOKEN` ovat Cloudflaren secretejä, eivät koodissa.
- Ilman oikeaa `UI_TOKEN`ia generointi- ja latausendpointit palauttavat 401.
- Vaihda `UI_TOKEN` `wrangler secret put UI_TOKEN` -komennolla jos se vuotaa.

## Jatkokehitys

- **R2-tallennus:** lisää R2-bucket ja tallenna generoidut kuvat pysyvästi
  (nyt fal-URLit vanhenevat — lataa kuva heti tai lisää R2).
- **Historia:** listaa aiemmin generoidut kuvat (vaatii tallennuksen, esim. R2 + D1).
- **Kuvasuhteet lisää:** täydennä `IMAGE_SIZE`-mappia tarpeen mukaan.
