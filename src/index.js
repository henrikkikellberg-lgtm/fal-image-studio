// fal.ai Image Studio — Cloudflare Worker
// v1.1.0 — lisätty nano-banana + nano-banana-pro (per-malli parametriadapteri)
//
// GET  /               → HTML-käyttöliittymä (prompti, kuvasuhde, malli)
// POST /api/generate   → proxy fal.ai:hin (bearer-token-suojattu). Body: {prompt, aspect, model, project?}
// GET  /api/download    → lataa fal-kuva palvelimen kautta (pakotettu tallennus, kiertää CDN:n vanhenemisen)
//
// Secretit (wrangler secret put):
//   FAL_KEY   — fal.ai API-avain (pysyy palvelimella, ei koskaan selaimeen)
//   UI_TOKEN  — oma bearer-token jolla suojaat tämän työkalun

const IMAGE_SIZE = {
  "16:9": "landscape_16_9",
  "1:1": "square_hd",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

const MODELS = {
  "fal-ai/flux/schnell": "Nopea & halpa (~0,003 $)",
  "fal-ai/flux/dev": "Tasapaino (~0,025 $)",
  "fal-ai/flux-pro/v1.1": "Flux Pro (~0,04 $)",
  "fal-ai/nano-banana": "Nano Banana (~0,04 $)",
  "fal-ai/nano-banana-pro": "Paras laatu — Nano Banana Pro (~0,15 $)",
};

// nano-banana-perhe käyttää aspect_ratio-parametria, flux käyttää image_size.
function isNano(model) {
  return model.indexOf("nano-banana") !== -1;
}

// Rakentaa fal.ai-pyynnön rungon mallin mukaan.
function buildFalBody(model, prompt, aspect) {
  if (isNano(model)) {
    const b = { prompt, aspect_ratio: aspect || "16:9", num_images: 1 };
    if (model === "fal-ai/nano-banana-pro") b.resolution = "2K"; // 1K/2K/4K (4K = tuplahinta)
    return b;
  }
  return { prompt, image_size: IMAGE_SIZE[aspect] || "landscape_16_9", num_images: 1 };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function checkAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!env.UI_TOKEN) return "UI_TOKEN puuttuu palvelimen konfiguraatiosta";
  if (!token || token !== env.UI_TOKEN) return "Väärä tai puuttuva token";
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      const authErr = checkAuth(request, env);
      if (authErr) return json({ error: authErr }, 401);
      if (!env.FAL_KEY) return json({ error: "FAL_KEY puuttuu palvelimelta" }, 500);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Virheellinen JSON" }, 400);
      }

      const prompt = (body.prompt || "").trim();
      if (!prompt) return json({ error: "Prompti puuttuu" }, 400);

      const model = MODELS[body.model] ? body.model : "fal-ai/flux/schnell";
      const aspect = body.aspect || "16:9";

      try {
        const falRes = await fetch("https://fal.run/" + model, {
          method: "POST",
          headers: {
            "Authorization": "Key " + env.FAL_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildFalBody(model, prompt, aspect)),
        });

        const data = await falRes.json();
        if (!falRes.ok) {
          return json({ error: "fal.ai virhe: " + (data.detail || falRes.status) }, 502);
        }
        const img = (data.images || [])[0];
        if (!img || !img.url) return json({ error: "fal.ai ei palauttanut kuvaa" }, 502);

        return json({
          url: img.url,
          width: img.width || null,
          height: img.height || null,
          model,
          aspect,
        });
      } catch (e) {
        return json({ error: "Kutsu fal.ai:hin epäonnistui: " + e.message }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/download") {
      // Selain ei voi asettaa Authorization-headeria <a>-linkille → hyväksy token myös ?t=
      const qToken = url.searchParams.get("t") || "";
      if (!env.UI_TOKEN || qToken !== env.UI_TOKEN) return new Response("Väärä tai puuttuva token", { status: 401 });
      const src = url.searchParams.get("url");
      const name = (url.searchParams.get("name") || "kuva").replace(/[^\w.-]/g, "_");
      if (!src || !src.startsWith("https://")) return new Response("Virheellinen url", { status: 400 });
      const r = await fetch(src);
      if (!r.ok) return new Response("Lataus epäonnistui", { status: 502 });
      const ct = r.headers.get("Content-Type") || "image/jpeg";
      const ext = ct.includes("png") ? "png" : "jpg";
      return new Response(r.body, {
        headers: {
          "Content-Type": ct,
          "Content-Disposition": 'attachment; filename="' + name + "." + ext + '"',
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

const PAGE = `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fal.ai Image Studio</title>
<style>
  :root { --bg:#0f1115; --card:#191c23; --line:#2a2f3a; --txt:#e7e9ee; --mut:#9aa3b2; --acc:#7c5cff; --acc2:#5a3fd6; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); }
  .wrap { max-width:760px; margin:0 auto; padding:28px 18px 60px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--mut); margin:0 0 22px; font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  label { display:block; font-size:12px; color:var(--mut); margin:0 0 6px; text-transform:uppercase; letter-spacing:.04em; }
  textarea, input, select { width:100%; background:#0f1218; color:var(--txt); border:1px solid var(--line); border-radius:9px; padding:10px 12px; font:inherit; }
  textarea { min-height:88px; resize:vertical; }
  .row { display:flex; gap:12px; }
  .row > div { flex:1; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { border:1px solid var(--line); background:#0f1218; color:var(--txt); border-radius:20px; padding:7px 14px; cursor:pointer; font-size:13px; }
  .chip.sel { background:var(--acc); border-color:var(--acc); color:#fff; }
  button.go { width:100%; margin-top:16px; background:var(--acc); color:#fff; border:none; border-radius:10px; padding:13px; font-size:15px; font-weight:600; cursor:pointer; }
  button.go:disabled { opacity:.5; cursor:not-allowed; }
  .mut { color:var(--mut); font-size:12px; }
  .out { text-align:center; }
  .out img { max-width:100%; border-radius:10px; border:1px solid var(--line); }
  .dl { display:inline-block; margin-top:12px; background:#0f1218; border:1px solid var(--line); color:var(--txt); border-radius:9px; padding:9px 16px; text-decoration:none; cursor:pointer; }
  .err { color:#ff8a8a; font-size:13px; margin-top:8px; }
  .spin { color:var(--mut); text-align:center; padding:20px; }
  .tokrow { display:flex; gap:10px; align-items:flex-end; }
  .tokrow > div { flex:1; }
  .savebtn { background:var(--acc2); color:#fff; border:none; border-radius:9px; padding:10px 14px; cursor:pointer; white-space:nowrap; }
</style>
</head>
<body>
<div class="wrap">
  <h1>fal.ai Image Studio</h1>
  <p class="sub">Generoi projektikohtaisia kuvia artikkeleihin ym. — bearer-tokenilla suojattu.</p>

  <div class="card">
    <div class="tokrow">
      <div>
        <label>Bearer-token</label>
        <input id="tok" type="password" placeholder="oma UI_TOKEN">
      </div>
      <button class="savebtn" onclick="saveTok()">Tallenna</button>
    </div>
    <p class="mut" id="tokstat" style="margin:8px 0 0"></p>
  </div>

  <div class="card">
    <label>Projekti / konteksti (valinnainen — auttaa nimeämään ja ohjaa promptia)</label>
    <input id="project" placeholder="esim. UAE-kiinteistö, blogiartikkeli X">

    <div style="height:14px"></div>
    <label>Kuvaus (prompti)</label>
    <textarea id="prompt" placeholder="esim. Luxury Dubai Marina living room at sunset, professional real estate photo, warm light"></textarea>

    <div style="height:14px"></div>
    <label>Kuvasuhde</label>
    <div class="chips" id="aspects">
      <div class="chip sel" data-a="16:9">16:9 vaaka</div>
      <div class="chip" data-a="1:1">1:1 neliö</div>
      <div class="chip" data-a="9:16">9:16 pysty</div>
      <div class="chip" data-a="4:3">4:3</div>
      <div class="chip" data-a="3:4">3:4</div>
    </div>

    <div style="height:14px"></div>
    <label>Malli / laatu</label>
    <select id="model">
      <option value="fal-ai/nano-banana-pro">Paras laatu — Nano Banana Pro (~0,15 $)</option>
      <option value="fal-ai/flux-pro/v1.1">Flux Pro (~0,04 $)</option>
      <option value="fal-ai/nano-banana">Nano Banana (~0,04 $)</option>
      <option value="fal-ai/flux/dev">Flux dev — tasapaino (~0,025 $)</option>
      <option value="fal-ai/flux/schnell">Flux schnell — nopea & halpa (~0,003 $)</option>
    </select>

    <button class="go" id="go" onclick="gen()">✨ Generoi kuva</button>
    <div class="err" id="err"></div>
  </div>

  <div class="card out" id="outcard" style="display:none">
    <div id="out"></div>
  </div>
</div>

<script>
  var aspect = "16:9";
  var lastUrl = null;

  function tok() { return document.getElementById("tok").value.trim(); }
  function saveTok() {
    try { localStorage.setItem("fal_ui_token", tok()); } catch(e) {}
    document.getElementById("tokstat").textContent = "Tallennettu selaimeen.";
  }
  (function initTok() {
    try {
      var t = localStorage.getItem("fal_ui_token");
      if (t) { document.getElementById("tok").value = t; document.getElementById("tokstat").textContent = "Ladattu selaimesta."; }
    } catch(e) {}
  })();

  var chips = document.querySelectorAll("#aspects .chip");
  chips.forEach(function(c) {
    c.onclick = function() {
      chips.forEach(function(x){ x.classList.remove("sel"); });
      c.classList.add("sel");
      aspect = c.getAttribute("data-a");
    };
  });

  async function gen() {
    var err = document.getElementById("err");
    err.textContent = "";
    var prompt = document.getElementById("prompt").value.trim();
    if (!tok()) { err.textContent = "Syötä bearer-token."; return; }
    if (!prompt) { err.textContent = "Syötä prompti."; return; }

    var go = document.getElementById("go");
    go.disabled = true; go.textContent = "Generoidaan…";
    var outcard = document.getElementById("outcard");
    var out = document.getElementById("out");
    outcard.style.display = "block";
    out.innerHTML = '<div class="spin">Generoidaan kuvaa… (nopealla mallilla muutama sekunti)</div>';

    try {
      var res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok() },
        body: JSON.stringify({
          prompt: prompt,
          aspect: aspect,
          model: document.getElementById("model").value,
          project: document.getElementById("project").value.trim()
        })
      });
      var j = await res.json();
      if (!res.ok) throw new Error(j.error || ("HTTP " + res.status));

      lastUrl = j.url;
      var proj = document.getElementById("project").value.trim() || "kuva";
      var safe = proj.replace(/[^\\w.-]/g, "_").slice(0, 40);
      var dl = "/api/download?url=" + encodeURIComponent(j.url) + "&name=" + encodeURIComponent(safe) + "&t=" + encodeURIComponent(tok());
      var dims = (j.width && j.height) ? (j.width + '×' + j.height + ' · ') : (j.aspect + ' · ');
      out.innerHTML = '<img src="' + j.url + '" alt="tulos">' +
        '<div><a class="dl" href="' + dl + '">⬇ Lataa kuva</a></div>' +
        '<p class="mut" style="margin-top:8px">' + dims + j.model + '</p>';
    } catch (e) {
      out.innerHTML = "";
      outcard.style.display = "none";
      err.textContent = e.message;
    } finally {
      go.disabled = false; go.textContent = "✨ Generoi kuva";
    }
  }
</script>
</body>
</html>`;
