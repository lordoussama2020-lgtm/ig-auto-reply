# IG Auto-Reply — Guide dyal setup (Darija)

Tool dyalek b-nefsek: wa7ed y-commenti kelma (VIBE, REPLICA, FREE…) f reel dyalek → l-tool kat-sift lih DM automatiquement fih l-link / document.

**L-code wajed 100%. L-partie l-9as7a machi l-code — hiya l-approbation dyal Meta.** 9ra l-guide kamel 9bel ma t-bda.

---

## 0. Chno khassk 9bel kolchi

| Chno | 3lach |
|---|---|
| Compte Instagram **Creator** (wla Business) | L-API ma khdamch m3a Personal |
| **Facebook Page** m-linkiya m3a l-Instagram | Meta kat-tlobha b7al "OAuth surface" |
| Compte **Meta Developer** (developers.facebook.com) | Bach t-creer l-app |
| Hosting (Render, free tier) | L-server khassou y-b9a khdam 24/7 b HTTPS |

---

## 1. Instagram → Creator account (5 min, f téléphone)

Instagram → Profile → Menu (☰) → **Settings** → **Account type and tools** → **Switch to professional account** → khtar **Creator** → khtar category (matalan "Digital creator") → Done.

Ma t-khafch: l-followers, l-posts, kolchi kay-b9a. W t-9der t-rj3o Personal moraha.

## 2. Facebook Page + linkiha m3a Instagram

- Sir l facebook.com → **Create Page** (smiha "Oussama AI Lab" matalan).
- F l-Page: **Settings → Linked accounts → Instagram → Connect** → dkhol b @oussama_ai_lab → autorisi.
- Wlla men Instagram: Settings → **Accounts Centre** → Pages → Add l-Page.

## 3. Creer l-app f Meta (developers.facebook.com)

1. Dkhol b Facebook dyalek → **My Apps → Create App** → khtar **Other** → **Business** (ila ma 3endekch business, **Other** khdam).
2. F l-app: **Add Product → Instagram** (Instagram API with Instagram Login).
3. F **Instagram → API Setup with Instagram Login**: connecti l-Instagram account (@oussama_ai_lab) b Facebook Login.
4. Permissions li khassk t-tlob (f **App Review → Permissions and Features**):
   - `instagram_business_basic` — profile + media
   - `instagram_business_manage_comments` — comments, webhooks, private replies
   - `instagram_business_manage_messages` — DMs (l-follow-ups)
   > ⚠️ L-smiyat l-9dam (`instagram_manage_comments`…) t-deprecat-iw f janvier 2025 — st3mel `instagram_business_*` kima l-fo9.
5. Zid rask b7al **Tester** (Roles → Testers) bach t-testi 9bel l-approbation.

## 4. Deployi l-server f Render (free)

1. Creer compte f **render.com** (b GitHub dyalek).
2. Creer repo f GitHub w uploadi ga3 l-files dyal `ig-auto-reply-tool/` (server.js, keywords.json, package.json, render.yaml).
3. F Render: **New → Web Service → Build from GitHub** → khtar l-repo → Render kay-9ra `render.yaml` bou7do.
4. F **Environment**: 3emmer:
   - `PAGE_ACCESS_TOKEN` — token dyal l-Page (chouf l-étape 5)
   - `VERIFY_TOKEN` — ay string khtariti (matalan `ig-reply-2026-secret`)
   - `APP_SECRET` — men l-app dashboard (Settings → Basic → App Secret)
   - `DRY_RUN` = `1` (l-awal, bach t-testi bla ma t-sift chi DM 7a9i9i)
5. Deploy → ghadi t-akhud URL b7al `https://ig-auto-reply-xxxx.onrender.com` — **ktebha**, ghadi t-7tajha f l-étape 6.

**Page Access Token (long-lived):** f developers.facebook.com → **Tools → Graph API Explorer** → khtar l-app dyalek → **Get Page Access Token** → khtar l-Page → permissions `instagram_basic, instagram_manage_comments, instagram_manage_messages` → **Generate** → moraha bedlo l **long-lived token** (f l-Explorer, clicki 3la ⓘ → Extend). Copyi l-token l Render.

## 5. Webhook: 3ellm Meta fin t-sift l-comments

F l-app dashboard → **Webhooks** → **Instagram** → **Subscribe**:
- Callback URL: `https://ig-auto-reply-xxxx.onrender.com/webhook`
- Verify token: nafs `VERIFY_TOKEN` li 3emmeriti f Render
- Subscribe to fields: **`comments`** (w `messages` ila bghiti t-testi l-DMs)

Meta ghadi t-sift `GET /webhook?hub.challenge=...` — l-server kay-jawb bou7do. Ila l-verification nja7, l-webhook khdam.

> Ila l-webhook ma t-approvach (kay-7taj **Advanced Access**), l-poller huwa l-plan B: 3emmer `POLL_MEDIA_IDS` f Render b l-ID dyal l-reels (l-ID kay-ban f l-link? Non — khud l-media ID men Graph API Explorer: `GET /me/media`), w l-server ghadi y-checki l-comments kol 5 min bou7do. Na7iya: polling kay-7taj `instagram_business_manage_comments` b7al l-webhook, walakin bla Advanced Access.

## 6. App Review — HNA L-PARTIE L-9AS7A (2–4 semaines)

Bach l-tool t-khdem 3la **nass 7a9i9iyin** (machi ghir testers), khass **Advanced Access** l-permissions. Meta kat-tlob:

1. **Business Verification** — wata2i9 dyal l-business (DX Media: registre de commerce wla 7ta auto-entrepreneur kay-kfi f b3d l-7alat).
2. **Screencast video** — video kat-weri kifach l-tool khdama: wa7ed y-commenti kelma → DM kay-wsel. Dirha b l-compte tester dyalek.
3. **Privacy Policy URL** — page f site dyalek (dxmediaagency.com/privacy-policy) kat-chre7 chno kat-jme3 (comment text + IG username, ghir bach t-sift l-DM) w chno ma kat-dirch (ma kat-bi3ch data, ma kat-siftich spam).
4. F **App Review → Requests**: tlob `instagram_business_manage_comments` + `instagram_business_manage_messages` → 3ti l-screencast + description.

**F l-mode "Development" (9bel l-approbation):** l-tool khdama ghir m3a l-users li zedtihom b7al Testers f l-app. Kafi bach t-testi kolchi, walakin ma ghadi t-jawbch l-public 7ta t-approva Meta.

## 7. Testi (DRY_RUN = 1)

1. Beddel `keywords.json` ila bghiti kelma jdida (w re-deployi).
2. Commenti b compte tester kelma (matalan `VIBE`) f reel dyalek.
3. Chouf l-logs f Render: khass y-ban `Queued "VIBE" from @tester` moraha `[DRY RUN] would POST /.../private_replies`.
4. Ila kolchi mzyan → beddel `DRY_RUN` l `0` f Render → re-deploy → l-DMs l-7a9i9iyin kay-t-sifto.

## 8. Kifach t-zid kelma jdida

F `keywords.json`, zid block:

```json
{
  "keyword": "GUIDE",
  "match": "contains",
  "mediaIds": ["all"],
  "publicReply": "Check DM 📩",
  "dmMessage": "Salam! Hna l-guide dyalek 👇\nhttps://ton-lien.com/guide.pdf"
}
```

- `mediaIds: ["all"]` = ay post. Bach t-7edded reel wa7ed: 7ett l-media ID dyalo.
- `match: "exact"` = l-comment khasso y-koun ghir l-kelma bou7da. `"contains"` (default) = l-kelma finma kant f l-comment.
- `"enabled": false` = flow wa9ef bla ma t-mse7 l-block.

---

## Rules li l-tool kat-7tarem bou7da (code)

- **1 DM par commentaire** — wa7ed comment = wa7ed DM, jamais 2.
- **7 jours max** — comment 9dim kter men 7 jours → ma kay-t-siftch DM (Meta kat-rejecti b error 551).
- **1 DM automatique par user par 24h** — ila wa7ed commenta 2 kelmat f nhar wa7ed, ghadi y-wslo ghir l-DM l-awal.
- **~12s delay** — Meta kat-tlob minimum 10s bin l-comment w l-DM.
- **Dedupe** — l-comment li t-jawb 3lih ma kay-t-3awedch, 7ta ila l-server t-restarta (kay-t7fed f `data/seen.json`).
- **Public reply optionnel** — "Check DM 📩" ta7t l-comment (t-9der t-7iydo b `publicReply: ""`).

## Wach n-qder n-tbanna b had l-tool?

**La — ila khdemti b l-API officiel kima hna.** Hiya nafs l-API li kay-st3mlo ManyChat/Chatfuel. Li kay-banni huwa: password-based bots, scraping, auto-like/follow, w mass DM l-nass li ma 3emro t-hadro m3ak. Had l-tool ma kat-dir 7ta wa7da men hadou: kat-jawb ghir l-nass li commentaw 3endek homa l-awal, b l-permissions dyal Meta.

## L-7a9i9a l-morra (b kol saraha)

- L-code: **wajed daba**, w t-testi f 1h.
- L-approbation dyal Meta: **2–4 semaines**, w t-9der t-trefed ila l-business verification wla l-screencast ma 3jebhomch.
- L-hosting free dyal Render: l-server kay-n3es ila ma ja 7ta request f 15 min (cold start ~30s) — l-webhook dyal Meta kay-t-redelivery, donc ma kay-daya3ch l-comments, walakin l-DM ghadi y-t-2ekher chwiya. L-plan payant dyal Render (~$7/mois) kay-7ell had l-mochkil.
- **L-alternative sri3a:** ManyChat Essential ~$14–17/mois — huma déjà 3endhom l-approbation, t-khdem l-youm bla App Review. Had l-tool dyalek kat-wfer lik $14/mois, walakin kat-khlsek b l-we9t dyal l-review.

Ila bghiti, n-mchi m3ak étape par étape: l-awal n-bedlo l-compte l Creator + n-creer l-Page, moraha l-app.
