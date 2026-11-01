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

  const WORKERS = 4;
  const running = {}; // traductions en cours, par clé : un 2e demandeur se branche dessus au lieu de tout refaire

  // Traduction déjà faite et gardée : null (déjà dans la bonne langue), la liste, ou undefined (pas encore).
  function cached(cacheKey) {
    const c = A.cacheGet("tr:" + A.settings.lang + ":" + cacheKey);
    return c ? (c.same ? null : c.p) : undefined;
  }

  async function translateAll(paras, key, tl, emit) {
    const chunks = pieces(paras);
    if (!chunks.length) return paras.slice();
    const out = paras.slice();
    const seen = new Set();
    const apply = (k, res) => {
      const ups = [];
      chunks[k].forEach((x, j) => {
        const t = res.lines[j] || x.t;
        out[x.i] = seen.has(x.i) ? out[x.i] + " " + t : t;
        seen.add(x.i);
        ups.push({ i: x.i, t: out[x.i] });
      });
      emit(ups);
    };
    // Le premier morceau (le haut du texte) seul : il dit aussi la langue d'origine.
    const first = await translateChunk(chunks[0], tl);
    if (first.src === tl) {
      if (key) A.cachePut(key, { same: true });
      return null;
    }
    apply(0, first);
    // La suite, dans l'ordre du texte, plusieurs requêtes à la fois ; chaque morceau s'affiche dès qu'il arrive.
    let next = 1;
    async function worker() {
      while (next < chunks.length) {
        const k = next++;
        apply(k, await translateChunk(chunks[k], tl));
      }
    }
    await Promise.all(Array.from({ length: Math.min(WORKERS, chunks.length - 1) }, worker));
    if (key) A.cachePut(key, { p: out });
    return out;
  }

  /**
   * Traduit une liste de paragraphes vers la langue des réglages.
   * Renvoie la liste traduite, ou null si le texte est déjà dans cette langue.
   * cacheKey : clé pour ne pas retraduire (null = pas de cache).
   * onChunk([{i, t}]) : appelé à chaque morceau traduit, pour afficher au fur et à mesure.
   */
  function paragraphs(paras, cacheKey, onChunk) {
    const tl = A.settings.lang;
    const key = cacheKey ? "tr:" + tl + ":" + cacheKey : null;
    if (key) {
      const c = A.cacheGet(key);
      if (c) return Promise.resolve(c.same ? null : c.p);
      const r = running[key];
      if (r) {
        if (onChunk) { r.listeners.add(onChunk); if (r.updates.length) onChunk(r.updates.slice()); }
        return r.promise;
      }
    }
    const job = { listeners: new Set(onChunk ? [onChunk] : []), updates: [] };
    const emit = (ups) => { job.updates.push(...ups); for (const l of job.listeners) l(ups); };
    job.promise = translateAll(paras, key, tl, emit).finally(() => { if (key) delete running[key]; });
    if (key) running[key] = job;
    return job.promise;
  }

  A.translate = { paragraphs, sameLanguage, pieces, cached };
})();
