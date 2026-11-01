// Traduction automatique par le service gratuit de Google Traduction (celui de translate.google.com).
// Le texte est envoyé par petits morceaux ; les paragraphes sont gardés ; le résultat est mis en cache.
(function () {
  "use strict";
  const A = window.FanficsApp;
  const MAX = 1400; // caractères par requête (l'adresse reste courte)

  // Les sites écrivent la langue en anglais (FanFiction.net : « French ») ou dans la langue même (AO3 : « Français »).
  const LANGS = {
    fr: /fran[cç]|french/i, en: /english|anglais/i, es: /espa[nñ]|spanish/i, de: /deutsch|allemand|german/i,
    it: /italian|italien/i, pt: /portugu/i,
  };

  // La fanfic est-elle déjà dans la langue de traduction choisie ? (langue inconnue -> non)
  function sameLanguage(language) {
    const re = LANGS[A.settings.lang];
    return !!(language && re && re.test(language));
  }

  // Découpe en morceaux de MAX caractères au plus ; un paragraphe trop long est coupé entre deux phrases.
  function pieces(paras) {
    const items = [];
    paras.forEach((p, i) => {
      if (!p || !/\p{L}/u.test(p)) return; // vide ou sans lettre (« * * * ») : gardé tel quel
      if (p.length <= MAX) { items.push({ i, t: p }); return; }
      let cur = "";
      for (const s of p.match(/[^.!?…]+[.!?…]*["»”’)]*\s*/g) || [p]) {
        if ((cur + s).length > MAX && cur) { items.push({ i, t: cur.trim() }); cur = ""; }
        cur += s;
        while (cur.length > MAX) { items.push({ i, t: cur.slice(0, MAX) }); cur = cur.slice(MAX); }
      }
      if (cur.trim()) items.push({ i, t: cur.trim() });
    });
    const chunks = [];
    let c = [], len = 0;
    for (const it of items) {
      if (c.length && len + it.t.length + 1 > MAX) { chunks.push(c); c = []; len = 0; }
      c.push(it);
      len += it.t.length + 1;
    }
    if (c.length) chunks.push(c);
    return chunks;
  }

  async function request(text, tl) {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + tl + "&dt=t&q=" + encodeURIComponent(text);
    const data = JSON.parse(await A.download(url, "other"));
    const out = (data[0] || []).map((s) => (s && s[0]) || "").join("");
    return { text: out, src: data[2] || "" };
  }

  // Traduit un morceau en gardant une ligne par élément ; si Google fusionne des lignes, on retraduit une à une.
  async function translateChunk(chunk, tl) {
    const r = await request(chunk.map((x) => x.t.replace(/\n/g, " ")).join("\n"), tl);
    const lines = r.text.split("\n").map((l) => l.trim());
    if (lines.length === chunk.length) return { lines, src: r.src };
    const one = [];
    for (const x of chunk) one.push((await request(x.t, tl)).text.trim());
    return { lines: one, src: r.src };
  }

  /**
   * Traduit une liste de paragraphes vers la langue des réglages.
   * Renvoie la liste traduite, ou null si le texte est déjà dans cette langue.
   * cacheKey : clé pour ne pas retraduire (null = pas de cache).
   */
  async function paragraphs(paras, cacheKey) {
    const tl = A.settings.lang;
    const key = cacheKey ? "tr:" + tl + ":" + cacheKey : null;
    if (key) {
      const c = A.cacheGet(key);
      if (c) return c.same ? null : c.p;
    }
    const chunks = pieces(paras);
    if (!chunks.length) return paras.slice();
    const results = new Array(chunks.length);
    results[0] = await translateChunk(chunks[0], tl);
    if (results[0].src === tl) {
      if (key) A.cachePut(key, { same: true });
      return null;
    }
    // Le reste, trois requêtes à la fois.
    let next = 1;
    async function worker() {
      while (next < chunks.length) {
        const k = next++;
        results[k] = await translateChunk(chunks[k], tl);
      }
    }
    await Promise.all([worker(), worker(), worker()]);

    const out = paras.slice();
    const seen = new Set();
    chunks.forEach((chunk, k) => chunk.forEach((x, j) => {
      const t = results[k].lines[j] || x.t;
      out[x.i] = seen.has(x.i) ? out[x.i] + " " + t : t;
      seen.add(x.i);
    }));
    if (key) A.cachePut(key, { p: out });
    return out;
  }

  A.translate = { paragraphs, sameLanguage, pieces };
})();
