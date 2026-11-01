// Mes Fanfics : liste, filtres, fiche, ajout par liens, nouveaux chapitres.
// Dans l'app Android, l'objet `Android` (MainActivity.Bridge) télécharge les pages et garde les données.
// Dans un navigateur ordinaire, tout reste dans le localStorage et les téléchargements passent par fetch().
(function () {
  "use strict";
  const P = window.Parsers;
  const native = typeof window.Android !== "undefined";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "" : n.toLocaleString("fr-FR"));

  const STATUS = [
    ["toread", "À lire"],
    ["reading", "En cours"],
    ["read", "Lues"],
    ["dropped", "Abandonnées"],
  ];
  const STATUS_ONE = { toread: "À lire", reading: "En cours", read: "Lue", dropped: "Abandonnée" };

  let fics = [];
  let authors = []; // auteurs favoris : {site, id, name, url, addedAt}
  // Réglages : traduction automatique vers `lang`, taille du texte du lecteur.
  // accounts : comptes de l'utilisatrice dont on importe les favoris.
  const settings = { autoTranslate: true, lang: "fr", fontSize: 19, accounts: [] };
  const view = { tab: "all", q: "", fandom: "", shelf: "", sort: "added" };
  const busy = new Set(); // ids en cours de téléchargement

  // ------------------------------------------------------------ stockage

  function load() {
    try {
      const raw = native ? Android.load() : localStorage.getItem("fanfics");
      const d = raw ? JSON.parse(raw) : null;
      fics = d && Array.isArray(d.fics) ? d.fics : [];
      if (d && d.settings) Object.assign(settings, d.settings);
      authors = d && Array.isArray(d.authors) ? d.authors : [];
    } catch (e) {
      fics = [];
      toast("Impossible de lire les données enregistrées.");
    }
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const json = JSON.stringify({ version: 1, fics, authors, settings });
    if (native) Android.save(json);
    else localStorage.setItem("fanfics", json);
  }
  // L'app passe en arrière-plan : on écrit tout de suite, elle peut être tuée ensuite.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (detailId && !editing) saveDetailFields(); if (saveTimer) flush(); }
  });

  // ------------------------------------------------------------ téléchargement

  const pending = {};
  let seq = 0;
  // Appelé par Java quand une réponse est prête.
  window.__fetched = function (id) {
    const cb = pending[id];
    delete pending[id];
    if (cb) cb(JSON.parse(Android.take(id)));
  };

  function nativeCall(method, url, ready) {
    return new Promise((resolve, reject) => {
      const id = "f" + ++seq;
      pending[id] = (r) => (r.ok ? resolve(r.body) : reject(new Error(r.error || "Erreur " + r.status)));
      if (method === "fetchBrowser") Android.fetchBrowser(id, url, ready || "");
      else Android.fetch(id, url);
    });
  }

  // FanFiction.net passe directement par le navigateur intégré (vérification anti-robot) ;
  // les autres sites aussi, mais seulement si la lecture simple se fait bloquer.
  // ready : sélecteur CSS qui prouve que la page attendue est chargée (navigateur intégré).
  function download(url, site, ready) {
    if (native) {
      const browser = typeof Android.fetchBrowser === "function";
      if (browser && site === "ffn") return nativeCall("fetchBrowser", url, ready);
      return nativeCall("fetch", url).catch((e) => {
        if (browser && /anti-robot/.test(e.message)) return nativeCall("fetchBrowser", url, ready);
        throw e;
      });
    }
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error("Erreur " + r.status);
      return r.text();
    }).catch((e) => {
      throw new Error(e instanceof TypeError ? "Le navigateur bloque la lecture de ce site : utilise l'app Android ou remplis les infos à la main." : e.message);
    });
  }

  // ------------------------------------------------------------ cache (chapitres, traductions)
  // Garde le texte déjà téléchargé : relecture instantanée et lecture hors ligne.

  function cacheGet(key) {
    try {
      const v = native ? Android.cacheGet(key) : localStorage.getItem("c:" + key);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function cachePut(key, value) {
    try {
      const v = JSON.stringify(value);
      if (native) Android.cachePut(key, v);
      else localStorage.setItem("c:" + key, v);
    } catch (e) { /* plein : tant pis, on retéléchargera */ }
  }
  function cacheClear() {
    if (native) Android.cacheClear();
    else for (const k of Object.keys(localStorage)) if (k.startsWith("c:")) localStorage.removeItem(k);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const queue = [];
  let running = false;

  function enqueue(fic, opts) {
    if (busy.has(fic.id)) return;
    busy.add(fic.id);
    queue.push({ id: fic.id, opts: opts || {} });
    run();
  }

  async function run() {
    if (running) return;
    running = true;
    let done = 0;
    while (queue.length) {
      showProgress(`Lecture des infos… ${done + 1}/${done + queue.length}`);
      const { id, opts } = queue.shift();
      const fic = fics.find((f) => f.id === id);
      if (fic) {
        await refresh(fic, opts);
        render();
        if (detailId === id) openDetail(id);
      }
      busy.delete(id);
      done++;
      // AO3 limite le nombre de requêtes : on reste poli.
      if (queue.length) await sleep(1500);
    }
    running = false;
    showProgress("");
    render();
    if (runEnd) { const f = runEnd; runEnd = null; f(); }
  }
  let runEnd = null;

  async function refresh(fic, opts) {
    try {
      const body = await download(P.fetchUrl(fic.url), fic.site);
      const info = P.parse(fic.url, body);
      const before = fic.chapters;
      for (const k of Object.keys(info)) {
        const v = info[k];
        const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
        // « Sur ? » et « terminée » ne sont fiables que si le site a donné un nombre de chapitres.
        if (k === "chaptersTotal" || k === "complete") { if (info.chapters != null) fic[k] = v; }
        else if (!empty) fic[k] = v;
      }
      if (opts.checkNew && before && fic.chapters && fic.chapters > before) {
        fic.newChapters = (fic.newChapters || 0) + (fic.chapters - before);
        opts.found && opts.found.push(fic);
      }
      fic.fetchedAt = Date.now();
      fic.error = "";
    } catch (e) {
      fic.error = e.message || String(e);
    }
    save();
  }

  // ------------------------------------------------------------ ajout

  const sameStory = (a, b) => P.storyKey(a) === P.storyKey(b);
  const findStory = (url) => fics.find((f) => sameStory(f.url, url));

  function addLinks(text, status, shelf) {
    const all = P.extractUrls(text);
    const profiles = all.map(P.profileOf).filter(Boolean);
    const urls = all.filter((u) => !P.profileOf(u));
    if (profiles.length && window.FanficsApp.askProfile) window.FanficsApp.askProfile(profiles);
    if (!urls.length) { if (!profiles.length) toast("Aucun lien trouvé."); return 0; }
    let added = 0, dup = 0;
    for (const url of urls) {
      const existing = findStory(url);
      if (existing) {
        dup++;
        if (shelf && !(existing.shelves || []).includes(shelf)) existing.shelves = [...(existing.shelves || []), shelf];
        continue;
      }
      const base = P.fromUrl(url);
      const fic = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        url, site: base.site, title: base.title, author: "",
        fandoms: [], relationships: [], characters: [], tags: [], warnings: [],
        rating: "", language: "", words: null, chapters: null, chaptersTotal: null, complete: false,
        published: "", updated: "", kudos: null, series: "", summary: "",
        status: status || "toread", fav: false, stars: 0, lastRead: 0, notes: "",
        shelves: shelf ? [shelf] : [], newChapters: 0, addedAt: Date.now(), fetchedAt: 0, error: "",
      };
      fics.unshift(fic);
      enqueue(fic);
      added++;
    }
    save();
    render();
    toast(added ? `${added} fanfic${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""}` + (dup ? ` (${dup} déjà dans ta liste)` : "") : "Déjà dans ta liste.");
    return added;
  }

  // Texte partagé depuis une autre app (navigateur, app AO3…).
  window.__shared = function () {
    const text = Android.takeShared();
    if (text) addLinks(text, "toread", "");
  };

  // ------------------------------------------------------------ filtres

  function matches(f, q) {
    if (!q) return true;
    const hay = [f.title, f.author, f.summary, f.notes, f.rating, f.language, f.series, P.SITES[f.site],
      ...(f.fandoms || []), ...(f.relationships || []), ...(f.characters || []), ...(f.tags || []), ...(f.shelves || [])]
      .join("\n").toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function inTab(f, tab) {
    if (tab === "all") return true;
    if (tab === "fav") return f.fav;
    if (tab === "new") return f.newChapters > 0;
    return f.status === tab;
  }

  function visible() {
    const list = fics.filter((f) => inTab(f, view.tab) && matches(f, view.q) &&
      (!view.fandom || (f.fandoms || []).includes(view.fandom)) &&
      (!view.shelf || (f.shelves || []).includes(view.shelf)));
    const by = {
      added: (a, b) => b.addedAt - a.addedAt,
      updated: (a, b) => String(b.updated || "").localeCompare(String(a.updated || "")) || b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }),
      author: (a, b) => (a.author || "~").localeCompare(b.author || "~", "fr", { sensitivity: "base" }) || a.title.localeCompare(b.title, "fr"),
      stars: (a, b) => b.stars - a.stars || b.fav - a.fav || b.addedAt - a.addedAt,
      words: (a, b) => (b.words || 0) - (a.words || 0),
    }[view.sort];
    return list.sort(by);
  }

  function countBy(fn) {
    const m = new Map();
    for (const f of fics) for (const v of fn(f) || []) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
  }

  function renderFilters() {
    const tabs = [["all", "Toutes"], ...STATUS, ["fav", "★ Favorites"]];
    const nNew = fics.filter((f) => f.newChapters > 0).length;
    if (nNew) tabs.splice(1, 0, ["new", "Nouveaux chapitres"]);
    if (view.tab === "new" && !nNew) view.tab = "all";
    tabs.push(["authors", "👤 Auteurs"]);
    $("tabs").innerHTML = tabs.map(([k, label]) => {
      const n = k === "authors" ? authors.length : fics.filter((f) => inTab(f, k)).length;
      return `<button data-tab="${k}" class="${view.tab === k ? "on" : ""}">${esc(label)}<small>${n}</small></button>`;
    }).join("");

    const fandoms = countBy((f) => f.fandoms);
    if (view.fandom && !fandoms.some(([k]) => k === view.fandom)) view.fandom = "";
    $("fFandom").innerHTML = `<option value="">Fandoms</option>` +
      fandoms.map(([k, n]) => `<option value="${esc(k)}"${k === view.fandom ? " selected" : ""}>${esc(k)} (${n})</option>`).join("");

    const shelves = countBy((f) => f.shelves);
    if (view.shelf && !shelves.some(([k]) => k === view.shelf)) view.shelf = "";
    $("fShelf").innerHTML = `<option value="">Étagères</option>` +
      shelves.map(([k, n]) => `<option value="${esc(k)}"${k === view.shelf ? " selected" : ""}>${esc(k)} (${n})</option>`).join("");
    $("fShelf").hidden = !shelves.length;
    $("shelves").innerHTML = shelves.map(([k]) => `<option value="${esc(k)}">`).join("");
  }

  // ------------------------------------------------------------ liste

  function chapText(f) {
    if (f.chapters == null) return "";
    return `${f.chapters}/${f.chaptersTotal == null ? "?" : f.chaptersTotal} chap.`;
  }

  function card(f) {
    const b = [];
    if (f.newChapters > 0) b.push(`<span class="b new">+${f.newChapters} chap.</span>`);
    b.push(`<span class="b">${esc(P.SITES[f.site] || "")}</span>`);
    if (f.rating) b.push(`<span class="b">${esc(f.rating)}</span>`);
    if (f.words) b.push(`<span class="b">${fmt(f.words)} mots</span>`);
    if (f.chapters != null) b.push(`<span class="b">${chapText(f)}</span>`);
    if (f.fetchedAt) b.push(f.complete ? `<span class="b done">Terminée</span>` : `<span class="b wip">En cours d'écriture</span>`);
    if (f.error && !f.fetchedAt && !busy.has(f.id)) b.push(`<span class="b err">infos non lues</span>`);
    for (const s of f.shelves || []) b.push(`<span class="b shelf">${esc(s)}</span>`);
    const total = f.chaptersTotal || f.chapters;
    const pct = total && f.lastRead ? Math.min(100, Math.round((f.lastRead / total) * 100)) : 0;
    return `<article class="card ${f.status}" data-id="${f.id}">
      ${f.fav ? `<span class="fav">★</span>` : ""}
      <div class="t">${esc(f.title)}</div>
      <div class="a">${f.author ? "par " + esc(f.author) : "&nbsp;"}${f.stars ? ` · <span class="stars">${"★".repeat(f.stars)}</span>` : ""}</div>
      ${f.fandoms && f.fandoms.length ? `<div class="f">${esc(f.fandoms.slice(0, 3).join(" · "))}</div>` : ""}
      <div class="badges">${b.join("")}</div>
      ${busy.has(f.id) ? `<div class="loading">Lecture des infos…</div>` : ""}
      ${pct ? `<div class="bar2"><i style="width:${pct}%"></i></div>` : ""}
    </article>`;
  }

  function authorFics(a) {
    const name = (a.name || "").toLowerCase();
    return fics.filter((f) => f.site === a.site && (f.author || "").toLowerCase().split(/,\s*/).includes(name));
  }

  function renderAuthors() {
    const q = view.q.toLowerCase();
    const list = authors.filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    $("list").innerHTML = list.map((a) => {
      const n = authorFics(a).length;
      return `<article class="card author" data-author="${esc(a.site + ":" + a.id)}">
        <div class="t">${esc(a.name)}</div>
        <div class="badges"><span class="b">${esc(P.SITES[a.site])}</span>${n ? `<span class="b shelf">${n} fic${n > 1 ? "s" : ""} dans ta liste</span>` : ""}</div>
        <div class="actions"><button class="ghost" data-au="remove">Retirer</button><button class="primary" data-au="works">Ses histoires</button></div>
      </article>`;
    }).join("");
    const empty = $("empty");
    empty.hidden = list.length > 0;
    empty.textContent = authors.length ? "Aucun auteur ne correspond." :
      "Aucun auteur favori.\n\nTouche + et colle le lien de ton compte (FanFiction.net, AO3 ou Wattpad) pour importer tes favoris,\nou le lien de la page d'un auteur.";
  }

  function render() {
    renderFilters();
    if (view.tab === "authors") return renderAuthors();
    const list = visible();
    $("list").innerHTML = list.map(card).join("");
    const empty = $("empty");
    empty.hidden = list.length > 0;
    empty.textContent = fics.length
      ? "Aucune fanfic ne correspond à ces filtres."
      : "Ta liste est vide.\n\nTouche + et colle le lien d'une fanfic,\nou partage une page vers « Mes Fanfics » depuis ton navigateur.";
  }

  // ------------------------------------------------------------ fiche

  let detailId = null;
  let editing = false;

  function openDetail(id) {
    const f = fics.find((x) => x.id === id);
    if (!f) return closeSheets();
    detailId = id;
    const total = f.chaptersTotal || f.chapters;
    const tags = (title, arr) => arr && arr.length
      ? `<div class="sec">${title}</div><div class="tagbox">${arr.map((t) => `<span class="b">${esc(t)}</span>`).join("")}</div>` : "";
    const meta = [
      ["Site", P.SITES[f.site]],
      ["Classement", f.rating],
      ["Avertissements", (f.warnings || []).join(", ")],
      ["Langue", f.language],
      ["Mots", fmt(f.words)],
      ["Chapitres", chapText(f)],
      ["État", f.fetchedAt ? (f.complete ? "Terminée" : "En cours d'écriture") : ""],
      ["Publiée", f.published],
      ["Mise à jour", f.updated],
      ["Série", f.series],
      [f.site === "wattpad" ? "Votes" : f.site === "ffn" ? "Favoris" : "Kudos", fmt(f.kudos)],
    ].filter(([, v]) => v);

    const body = editing ? editForm(f) : `
      <div class="d-title">${esc(f.title)}</div>
      <div class="d-sub">${f.author ? "par " + esc(f.author) : "auteur inconnu"}</div>
      ${f.newChapters > 0 ? `<p><span class="b new">${f.newChapters} nouveau${f.newChapters > 1 ? "x" : ""} chapitre${f.newChapters > 1 ? "s" : ""}</span> <button class="ghost" data-act="seen">Vu</button></p>` : ""}
      ${f.error && !busy.has(f.id) ? `<p class="hint" style="color:var(--bad)">${f.fetchedAt ? "Dernière relecture impossible : " : ""}${esc(f.error)}</p>` : ""}
      ${busy.has(f.id) ? `<p class="hint">Lecture des infos…</p>` : ""}

      <div class="seg">${STATUS.map(([k]) => `<button data-status="${k}" class="${f.status === k ? "on" : ""}">${STATUS_ONE[k]}</button>`).join("")}</div>

      <div class="line">
        <div class="big-stars">${[1, 2, 3, 4, 5].map((i) => `<button data-star="${i}" class="${f.stars >= i ? "on" : ""}">★</button>`).join("")}</div>
        <button class="favbtn ${f.fav ? "on" : ""}" data-act="fav">${f.fav ? "★ Favorite" : "☆ Favorite"}</button>
      </div>

      <div class="line">
        <span>Lu jusqu'au chapitre</span>
        <div class="stepper">
          <button data-act="minus">−</button>
          <input id="lastRead" type="number" min="0" inputmode="numeric" value="${f.lastRead || 0}">
          <button data-act="plus">+</button>
        </div>
        ${total ? `<span class="hint" style="margin:0">sur ${total}</span>` : ""}
      </div>

      <label class="row">Étagères <input id="dShelves" list="shelves" value="${esc((f.shelves || []).join(", "))}" placeholder="ex. Slow burn, À relire"></label>
      <div class="sec">Mes notes</div>
      <textarea id="dNotes" rows="3" placeholder="Ce que j'en pense, où j'en suis…">${esc(f.notes)}</textarea>

      <div class="actions">
        <button class="primary" data-act="read">📖 ${f.readCh ? "Reprendre au chap. " + f.readCh : "Lire"}</button>
        <button class="ghost" data-act="open">Sur le site</button>
        <button class="ghost" data-act="refresh">Relire les infos</button>
        <button class="ghost" data-act="edit">Modifier</button>
      </div>

      ${f.summary ? `<div class="sec">Résumé <button class="link" data-act="trSummary" id="trSummaryBtn" hidden></button></div><div class="summary" id="dSummary">${esc(f.summary)}</div>` : ""}
      ${tags("Fandoms", f.fandoms)}
      ${tags("Relations", f.relationships)}
      ${tags("Personnages", f.characters)}
      ${tags("Tags", f.tags)}
      ${meta.length ? `<dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      <p class="hint" style="word-break:break-all">${esc(f.url)}</p>
      <div class="actions">
        <button class="danger" data-act="delete">Supprimer</button>
        <button class="ghost" data-close>Fermer</button>
      </div>`;
    $("detailBody").innerHTML = body;
    $("detail").hidden = false;
    if (!editing && f.summary) showSummary(f, null);
  }

  // Résumé traduit automatiquement (si la fanfic n'est pas déjà dans la langue choisie).
  const summaryOriginal = new Set();
  function showSummary(f, forceOriginal) {
    const T = window.FanficsApp && window.FanficsApp.translate;
    if (!T) return;
    const box = $("dSummary"), btn = $("trSummaryBtn");
    if (forceOriginal != null) { if (forceOriginal) summaryOriginal.add(f.id); else summaryOriginal.delete(f.id); }
    const wantOriginal = summaryOriginal.has(f.id) || !settings.autoTranslate || T.sameLanguage(f.language);
    btn.hidden = false;
    if (wantOriginal) {
      box.textContent = f.summary;
      btn.textContent = "Traduire";
      btn.dataset.act = "trSummary";
      return;
    }
    btn.textContent = "Traduction…";
    T.paragraphs(f.summary.split(/\n+/), "sum:" + f.id + ":" + f.summary.length).then((tr) => {
      if (detailId !== f.id || !$("dSummary")) return;
      if (!tr) { btn.hidden = true; return; } // déjà dans la bonne langue
      $("dSummary").textContent = tr.join("\n\n");
      $("trSummaryBtn").textContent = "Voir l'original";
      $("trSummaryBtn").dataset.act = "origSummary";
    }).catch(() => { if ($("trSummaryBtn")) $("trSummaryBtn").textContent = "Traduction impossible"; });
  }

  function editForm(f) {
    const v = (x) => esc(x == null ? "" : x);
    const list = (a) => esc((a || []).join(", "));
    return `<h2>Modifier les infos</h2><div class="edit">
      <label>Titre<input id="eTitle" value="${v(f.title)}"></label>
      <label>Auteur<input id="eAuthor" value="${v(f.author)}"></label>
      <label>Fandoms (séparés par des virgules)<input id="eFandoms" value="${list(f.fandoms)}"></label>
      <label>Relations<input id="eRel" value="${list(f.relationships)}"></label>
      <label>Tags<input id="eTags" value="${list(f.tags)}"></label>
      <div class="two">
        <label>Chapitres<input id="eCh" type="number" min="0" value="${v(f.chapters)}"></label>
        <label>Sur (vide = ?)<input id="eTot" type="number" min="0" value="${v(f.chaptersTotal)}"></label>
        <label>Mots<input id="eWords" type="number" min="0" value="${v(f.words)}"></label>
      </div>
      <label>Classement<input id="eRating" value="${v(f.rating)}"></label>
      <label>Lien<input id="eUrl" value="${v(f.url)}"></label>
      <label>Résumé<textarea id="eSummary" rows="5">${v(f.summary)}</textarea></label>
    </div>
    <div class="actions">
      <button class="ghost" data-act="cancelEdit">Annuler</button>
      <button class="primary" data-act="saveEdit">Enregistrer</button>
    </div>`;
  }

  function splitList(s) {
    const out = [];
    for (const x of String(s || "").split(",").map((t) => t.trim()).filter(Boolean)) if (!out.includes(x)) out.push(x);
    return out;
  }
  const intOrNull = (s) => (String(s).trim() === "" ? null : Math.max(0, parseInt(s, 10) || 0));

  function detailAction(act, f) {
    switch (act) {
      case "fav": f.fav = !f.fav; break;
      case "seen": f.newChapters = 0; break;
      case "minus": setLastRead(f, (f.lastRead || 0) - 1); break;
      case "plus": setLastRead(f, (f.lastRead || 0) + 1); break;
      case "open": {
        let url = f.url;
        if (f.site === "ffn" && f.lastRead) {
          const total = f.chaptersTotal || f.chapters || f.lastRead + 1;
          url = url.replace(/\/s\/(\d+)\/\d+/, `/s/$1/${Math.min(f.lastRead + 1, total)}`);
        }
        f.newChapters = 0;
        if (f.status === "toread") f.status = "reading";
        openUrl(url);
        break;
      }
      case "refresh": enqueue(f); break;
      case "read": closeSheets(); window.FanficsApp.openReader(f.id); return;
      case "trSummary": showSummary(f, false); return;
      case "origSummary": showSummary(f, true); return;
      case "edit": editing = true; break;
      case "cancelEdit": editing = false; break;
      case "saveEdit": {
        f.title = $("eTitle").value.trim() || f.title;
        f.author = $("eAuthor").value.trim();
        f.fandoms = splitList($("eFandoms").value);
        f.relationships = splitList($("eRel").value);
        f.tags = splitList($("eTags").value);
        f.chapters = intOrNull($("eCh").value);
        f.chaptersTotal = intOrNull($("eTot").value);
        f.complete = f.chaptersTotal != null && f.chapters === f.chaptersTotal;
        f.words = intOrNull($("eWords").value);
        f.rating = $("eRating").value.trim();
        f.summary = $("eSummary").value.trim();
        const url = P.canonical($("eUrl").value.trim());
        if (url && url !== f.url) {
          if (fics.some((x) => x !== f && sameStory(x.url, url))) toast("Ce lien est déjà dans ta liste.");
          else { f.url = url; f.site = P.siteOf(url); }
        }
        if (!f.fetchedAt) f.fetchedAt = Date.now();
        f.error = "";
        editing = false;
        break;
      }
      case "delete":
        if (!confirm(`Supprimer « ${f.title} » de ta liste ?`)) return;
        fics = fics.filter((x) => x !== f);
        save();
        render();
        closeSheets();
        toast("Supprimée.");
        return;
    }
    save();
    render();
    openDetail(f.id);
  }

  function setLastRead(f, n) {
    const total = f.chaptersTotal || f.chapters;
    f.lastRead = Math.max(0, total ? Math.min(n, total) : n);
    if (f.lastRead > 0 && f.status === "toread") f.status = "reading";
    if (total && f.lastRead >= total) {
      f.newChapters = 0;
      if (f.complete && f.status === "reading") f.status = "read";
    }
  }

  // ------------------------------------------------------------ mises à jour

  function checkUpdates() {
    const targets = fics.filter((f) => !f.complete && f.status !== "dropped");
    if (!targets.length) { toast("Aucune fanfic en cours d'écriture à vérifier."); return; }
    const found = [];
    for (const f of targets) enqueue(f, { checkNew: true, found });
    runEnd = () => {
      if (found.length) {
        view.tab = "new";
        render();
        toast(`Nouveaux chapitres pour ${found.length} fanfic${found.length > 1 ? "s" : ""} !`);
      } else toast("Pas de nouveau chapitre.");
    };
  }

  // ------------------------------------------------------------ sauvegarde

  function exportData() {
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), fics, authors, accounts: settings.accounts }, null, 1);
    const name = "mes-fanfics-" + new Date().toISOString().slice(0, 10) + ".json";
    if (native) { Android.exportFile(name, json); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function importData(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { toast("Ce fichier n'est pas une sauvegarde valide."); return; }
    const list = Array.isArray(d) ? d : d && d.fics;
    if (!Array.isArray(list)) { toast("Ce fichier n'est pas une sauvegarde valide."); return; }
    let added = 0, merged = 0;
    for (const f of list) {
      if (!f || !f.url) continue;
      const cur = findStory(f.url);
      if (cur) {
        // Restaurer = la sauvegarde fait foi pour les fanfics qu'elle contient.
        Object.assign(cur, f, { id: cur.id });
        merged++;
      } else {
        fics.push(Object.assign({ shelves: [], fandoms: [], tags: [], status: "toread", stars: 0, lastRead: 0, addedAt: Date.now() }, f));
        added++;
      }
    }
    if (d && Array.isArray(d.authors)) for (const a of d.authors) addAuthor(a);
    if (d && Array.isArray(d.accounts)) for (const a of d.accounts) if (!settings.accounts.some((x) => x.url === a.url)) settings.accounts.push(a);
    save();
    render();
    closeSheets();
    toast(`${added} ajoutée${added > 1 ? "s" : ""}, ${merged} remise${merged > 1 ? "s" : ""} comme dans la sauvegarde.`);
  }
  window.__imported = function () { importData(Android.takeShared()); };

  // ------------------------------------------------------------ divers

  function openUrl(url) {
    if (native) Android.open(url);
    else window.open(url, "_blank", "noopener");
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  function showProgress(msg) {
    $("progress").hidden = !msg;
    $("progress").textContent = msg;
  }

  function closeSheets() {
    if (detailId && !editing) saveDetailFields();
    for (const s of document.querySelectorAll(".sheet")) s.hidden = true;
    detailId = null;
    editing = false;
  }

  // Champs texte de la fiche : enregistrés à la fermeture et à chaque modification.
  function saveDetailFields() {
    const f = fics.find((x) => x.id === detailId);
    if (!f || !$("dNotes")) return;
    f.notes = $("dNotes").value;
    f.shelves = splitList($("dShelves").value);
    save();
    render();
  }

  // Bouton Retour d'Android : ferme d'abord ce qui est ouvert. Renvoie true si quelque chose a été fermé.
  const backHandlers = []; // lecteur, recherche : fermés en premier
  window.__back = function () {
    if (editing) { editing = false; openDetail(detailId); return true; }
    if ([...document.querySelectorAll(".sheet")].some((s) => !s.hidden)) { closeSheets(); return true; }
    for (const h of backHandlers) if (h()) return true;
    if (view.q || view.tab !== "all" || view.fandom || view.shelf) {
      view.q = ""; view.tab = "all"; view.fandom = ""; view.shelf = "";
      $("search").value = "";
      render();
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------ événements

  $("search").addEventListener("input", (e) => { view.q = e.target.value.trim(); render(); });
  $("fFandom").addEventListener("change", (e) => { view.fandom = e.target.value; render(); });
  $("fShelf").addEventListener("change", (e) => { view.shelf = e.target.value; render(); });
  $("fSort").addEventListener("change", (e) => { view.sort = e.target.value; render(); });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) { view.tab = b.dataset.tab; render(); }
  });
  $("list").addEventListener("click", (e) => {
    const au = e.target.closest("[data-author]");
    if (au) {
      const a = authors.find((x) => x.site + ":" + x.id === au.dataset.author);
      const b = e.target.closest("[data-au]");
      if (!a) return;
      if (b && b.dataset.au === "remove") {
        if (!confirm(`Retirer ${a.name} de tes auteurs favoris ?`)) return;
        authors = authors.filter((x) => x !== a);
        save(); render();
      } else window.FanficsApp.openAuthor(a);
      return;
    }
    const c = e.target.closest(".card");
    if (c) { editing = false; openDetail(c.dataset.id); }
  });

  $("fab").addEventListener("click", () => {
    $("addStatus").innerHTML = STATUS.map(([k]) => `<option value="${k}">${STATUS_ONE[k]}</option>`).join("");
    $("addText").value = "";
    $("addShelf").value = view.shelf || "";
    $("addSheet").hidden = false;
    setTimeout(() => $("addText").focus(), 50);
  });
  $("addGo").addEventListener("click", () => {
    const text = $("addText").value;
    addLinks(text, $("addStatus").value, $("addShelf").value.trim());
    if (P.extractUrls(text).length) $("addSheet").hidden = true; // pas les autres : la question « ton compte ? » peut s'ouvrir
  });

  $("detailBody").addEventListener("click", (e) => {
    const f = fics.find((x) => x.id === detailId);
    if (!f) return;
    const t = e.target.closest("button");
    if (!t || t.hasAttribute("data-close")) return;
    if (!editing) saveDetailFields();
    if (t.dataset.status) {
      f.status = t.dataset.status;
      if (f.status === "read") { const tot = f.chaptersTotal || f.chapters; if (tot) f.lastRead = tot; f.newChapters = 0; }
      save(); render(); openDetail(f.id);
    } else if (t.dataset.star) {
      const n = +t.dataset.star;
      f.stars = f.stars === n ? 0 : n;
      save(); render(); openDetail(f.id);
    } else if (t.dataset.act) detailAction(t.dataset.act, f);
  });
  $("detailBody").addEventListener("change", (e) => {
    const f = fics.find((x) => x.id === detailId);
    if (!f || editing) return;
    if (e.target.id === "lastRead") { setLastRead(f, parseInt(e.target.value, 10) || 0); save(); render(); openDetail(f.id); }
    else saveDetailFields();
  });

  for (const s of document.querySelectorAll(".sheet")) {
    s.addEventListener("click", (e) => {
      if (e.target === s || e.target.hasAttribute("data-close")) closeSheets();
    });
  }

  $("btnUpdates").addEventListener("click", checkUpdates);
  $("btnSearch").addEventListener("click", () => window.FanficsApp.openSearch());
  $("btnMenu").addEventListener("click", () => {
    const words = fics.filter((f) => f.status === "read").reduce((s, f) => s + (f.words || 0), 0);
    $("stats").textContent = `${fics.length} fanfic${fics.length > 1 ? "s" : ""} · ${fics.filter((f) => f.status === "read").length} lue${fics.filter((f) => f.status === "read").length > 1 ? "s" : ""}` +
      (words ? ` · ${fmt(words)} mots lus` : "") + (native ? "" : " · Mode navigateur : les infos des sites ne peuvent pas toujours être lues.");
    $("setAuto").checked = settings.autoTranslate;
    $("setLang").value = settings.lang;
    $("menu").hidden = false;
  });
  $("setAuto").addEventListener("change", (e) => { settings.autoTranslate = e.target.checked; save(); });
  $("setLang").addEventListener("change", (e) => { settings.lang = e.target.value; save(); });
  $("mClearCache").addEventListener("click", () => { cacheClear(); closeSheets(); toast("Chapitres et traductions effacés de l'appareil."); });
  $("mExport").addEventListener("click", () => { exportData(); closeSheets(); });
  $("mImport").addEventListener("click", () => { closeSheets(); native ? Android.importFile() : $("fileIn").click(); });
  $("fileIn").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) file.text().then(importData);
    e.target.value = "";
  });
  $("mRefreshAll").addEventListener("click", () => {
    closeSheets();
    if (!fics.length) return;
    for (const f of fics) enqueue(f, { checkNew: true, found: [] });
  });

  // ------------------------------------------------------------ démarrage

  // Ajout depuis la recherche : les infos sont déjà connues, pas besoin de retélécharger.
  function addFromInfo(info, status, quiet) {
    const existing = findStory(info.url);
    if (existing) return existing;
    const fic = Object.assign({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      status: status || "toread", fav: false, stars: 0, lastRead: 0, notes: "",
      shelves: [], newChapters: 0, addedAt: Date.now(), fetchedAt: Date.now(), error: "",
    }, info);
    fics.unshift(fic);
    save();
    if (!quiet) render(); // import en masse : un seul affichage à la fin
    return fic;
  }

  function addAuthor(a) {
    if (!a || !a.site || !a.id || authors.some((x) => x.site === a.site && x.id === a.id)) return false;
    authors.push({ site: a.site, id: a.id, name: a.name || a.id, url: a.url, addedAt: a.addedAt || Date.now() });
    save();
    return true;
  }

  window.FanficsApp = {
    addLinks, addFromInfo, importData, download, cacheGet, cachePut, save, flush, render, toast, esc, fmt,
    setLastRead, openDetail, backHandlers, settings, native,
    get fics() { return fics; },
    get authors() { return authors; },
    addAuthor, view, showProgress,
    find: (id) => fics.find((f) => f.id === id),
    findStory,
  };

  load();
  render();
  // Fanfics ajoutées mais jamais lues (app fermée pendant le téléchargement).
  for (const f of fics) if (!f.fetchedAt && !f.error) enqueue(f);
  if (native) Android.ready();
})();
