// Découvrir : recherche d'histoires (AO3, FanFiction.net, Wattpad), recherche de comptes par pseudo,
// et pages de profil (histoires, favoris, auteurs suivis… tout ce qui est public).
(function () {
  "use strict";
  const A = window.FanficsApp;
  const P = window.Parsers;
  const S = P.Search;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const SITE_ORDER = ["ao3", "ffn", "wattpad"];

  // mode : "stories" (recherche d'histoires), "accounts" (recherche de comptes), "list" (page de profil)
  const state = {
    mode: "stories", site: "ao3", q: "", page: 1, results: [], next: false, token: 0, loading: false, error: "",
    list: null, // {title, sections: [{label, load(page)}], section, hero(), onHero(act)}
  };

  function opts() {
    return state.site === "ao3" ? { language: $("sLang").value, sort: $("sSort").value, complete: $("sComplete").checked } : {};
  }

  const inList = (r) => A.findStory(r.url);
  const keyOf = (r) => r.url || r.site + ":" + r.id;

  // ------------------------------------------------------------ cartes

  function storyCard(r, i) {
    const b = [];
    if (r.rating) b.push(`<span class="b">${esc(r.rating)}</span>`);
    if (r.language) b.push(`<span class="b">${esc(r.language)}</span>`);
    if (r.words) b.push(`<span class="b">${A.fmt(r.words)} mots</span>`);
    if (r.chapters != null) b.push(`<span class="b">${r.chapters}/${r.chaptersTotal == null ? "?" : r.chaptersTotal} chap.</span>`);
    b.push(r.complete ? `<span class="b done">Terminée</span>` : `<span class="b wip">En cours d'écriture</span>`);
    if (r.kudos) b.push(`<span class="b">♥ ${A.fmt(r.kudos)}</span>`);
    const tags = [...(r.relationships || []), ...(r.tags || [])].slice(0, 6);
    const mine = inList(r);
    const summary = r.summaryTr && !r.showOrig ? r.summaryTr : r.summary;
    return `<article class="card sres" data-i="${i}" style="--i:${i % 12}">
      <div class="crow">
        ${A.cover(r, "sm")}
        <div class="cbody">
          <div class="t">${esc(r.title)}</div>
          <div class="a">${r.author ? `par ${P.authorProfile(r) ? `<button class="link author-link" data-s="author">${esc(r.author)}</button>` : esc(r.author)}${A.isFavAuthor(r) ? ` <span class="fav-mini">★</span>` : ""}` : ""}</div>
          ${r.fandoms && r.fandoms.length ? `<div class="f">${esc(r.fandoms.slice(0, 3).join(" · "))}</div>` : ""}
        </div>
      </div>
      <div class="badges">${b.join("")}</div>
      ${tags.length ? `<div class="badges">${tags.map((t) => `<span class="b shelf">${esc(t)}</span>`).join("")}</div>` : ""}
      ${summary ? `<div class="ssum">${esc(summary)}</div>` : ""}
      ${r.summaryTr ? `<button class="link" data-s="${r.showOrig ? "tr" : "orig"}">${r.showOrig ? "Voir la traduction" : "Résumé traduit · voir l'original"}</button>` : ""}
      <div class="actions">
        ${mine ? `<button class="ghost" data-s="detail">✓ Dans ta liste</button>` : `<button class="ghost" data-s="add">+ Ajouter</button>`}
        <button class="primary" data-s="read">📖 Lire</button>
      </div>
    </article>`;
  }

  function personCard(r, i) {
    const fav = A.authors.some((a) => a.site === r.site && a.id === r.id);
    const isAccount = r.kind === "account";
    const stats = (r.stats || []).map(([n, l]) => `<span class="b">${A.fmt(n)} ${esc(A.plural(n, l))}</span>`).join("");
    return `<article class="card person sres" data-i="${i}" style="--i:${i % 12}">
      <div class="crow">
        ${A.avatar(r.name, r.site)}
        <div class="cbody">
          <div class="t">${esc(r.name)}</div>
          <div class="badges"><span class="b site-${r.site}">${esc(P.SITES[r.site])}</span>${stats}</div>
        </div>
      </div>
      ${isAccount && r.bio ? `<div class="ssum">${esc(r.bio)}</div>` : ""}
      ${isAccount && r.joined ? `<div class="hint" style="margin:6px 0 0">Membre depuis ${esc(r.joined)}</div>` : ""}
      <div class="actions">
        <button class="ghost" data-s="fav">${fav ? "✓ Auteur favori" : "☆ Auteur favori"}</button>
        <button class="primary" data-s="profile">${isAccount ? "Tout voir" : "Voir le profil"}</button>
      </div>
    </article>`;
  }

  // Le site exige d'être connecté(e) (FanFiction.net pour chercher un pseudo).
  const LOGIN_URL = { ffn: "https://www.fanfiction.net/login.php" };
  function loginCard(r, i) {
    return `<article class="card person sres login" data-i="${i}" style="--i:${i % 12}">
      <div class="crow">${A.avatar("?", r.site)}<div class="cbody">
        <div class="t">${esc(P.SITES[r.site])} : connexion demandée</div>
        <div class="a">${esc(P.SITES[r.site])} ne laisse chercher un pseudo qu'aux membres connectés.</div>
      </div></div>
      <div class="hint" style="margin:8px 0 0">${A.native ? "Connecte-toi une fois dans l'app (elle garde la session), ou" : ""} colle le lien du profil (<b>fanfiction.net/u/…</b>) avec le bouton +.</div>
      <div class="actions">${A.native && LOGIN_URL[r.site] ? `<button class="primary" data-s="login">Me connecter à ${esc(P.SITES[r.site])}</button>` : ""}</div>
    </article>`;
  }

  const card = (r, i) => (r.kind === "login" ? loginCard(r, i) : r.kind === "author" || r.kind === "account" ? personCard(r, i) : storyCard(r, i));

  // Nouvelles histoires de mes auteurs, trouvées par la vérification en arrière-plan.
  function newsHtml() {
    const news = A.settings.news || [];
    if (!news.length) return "";
    return `<div class="sechead"><b>🆕 Nouveautés de tes auteurs</b><span>${news.length}</span><button class="link" data-x="clear">Tout effacer</button></div>` +
      news.map((x, k) => `<article class="card sres news" data-n="${k}">
        <div class="crow">${A.cover(x, "sm")}<div class="cbody">
          <div class="t">${esc(x.title)}</div>
          <div class="a">par ${esc(x.author)} · ${esc(P.SITES[x.site] || "")}</div>
          <div class="st">Nouvelle histoire · ${new Date(x.t).toLocaleDateString("fr-FR")}</div>
        </div></div>
        <div class="actions"><button class="ghost" data-x="dismiss">✕</button><button class="ghost" data-x="add">+ Ajouter</button><button class="primary" data-x="read">📖 Lire</button></div>
      </article>`).join("");
  }

  function emptyText() {
    if (state.note) return "";
    if (state.mode === "list") return state.list.sections[state.list.section].empty || "Rien de public ici.";
    if (state.mode === "accounts") return state.q ? `Aucun compte « ${state.q} » trouvé.` : "";
    return state.q ? "Aucun résultat." : "";
  }

  function render() {
    const box = $("sResults");
    let html = state.mode === "list" && state.list.hero ? state.list.hero() : "";
    if (state.note && state.mode === "stories") html += `<p class="hint tip">${esc(state.note)}</p>`;
    html += state.results.map(card).join("");
    if (state.loading) html += `<div class="rwait"><div class="spinner"></div>${state.mode === "accounts" ? "Recherche du compte sur les trois sites…" : "Chargement…"}${state.site === "ffn" || state.mode !== "stories" ? "<br><small>FanFiction.net peut prendre quelques secondes.</small>" : ""}</div>`;
    else if (state.error) html += `<p class="rwait">${esc(state.error)}</p>`;
    else if (!state.results.some((r) => r.kind !== "login") && emptyText()) html += `<p class="rwait">${esc(emptyText())}</p>`;
    else if (state.next) html += `<div class="actions" style="justify-content:center"><button class="ghost" data-s="more">Plus de résultats</button></div>`;
    if (state.mode === "accounts" && !state.q && !state.loading) {
      // Écran d'accueil des auteurs : nouveautés, mes auteurs favoris, puis la recherche par pseudo.
      html = newsHtml() + (state.results.length
        ? `<div class="sechead"><b>★ Mes auteurs favoris</b><span>${state.results.length}</span></div>` + state.results.map(card).join("") +
          `<p class="hint tip">Pour en ajouter : tape un pseudo ci-dessus, ou touche « ☆ Auteur favori » dans la fiche d'une fanfic.</p>`
        : `<div class="welcome"><div class="big">⭐</div><b>Tes auteurs favoris</b><p>Touche « ☆ Auteur favori » dans la fiche d'une fanfic, ou tape un pseudo ci-dessus : l'app le cherche sur AO3, FanFiction.net et Wattpad et te montre tout ce qui est public (histoires, favoris, marque-pages, auteurs suivis).</p></div>`);
    } else if (state.mode === "stories" && !state.q && !state.results.length && !state.loading) {
      html = `<div class="welcome"><div class="big">✨</div><b>Trouve ta prochaine fanfic</b><p>Un titre, un fandom, un personnage, un couple ou un tag.<br>Ex. « Drarry slow burn », « Naruto », « enemies to lovers ».</p></div>`;
    }
    box.innerHTML = html;
  }

  // Traduit les résumés des résultats qui ne sont pas dans la langue choisie (une seule série de requêtes).
  async function translateSummaries(items, t) {
    if (!A.settings.autoTranslate) return;
    const todo = items.filter((r) => !r.kind && r.summary && !A.translate.sameLanguage(r.language));
    if (!todo.length) return;
    try {
      const tr = await A.translate.paragraphs(todo.map((r) => r.summary.replace(/\s*\n+\s*/g, " ")), null);
      if (t !== state.token || !tr) return;
      todo.forEach((r, i) => { if (tr[i] && tr[i] !== r.summary) r.summaryTr = tr[i]; });
      render();
    } catch (e) { /* résumés laissés en version originale */ }
  }

  // ------------------------------------------------------------ chargement

  async function runAccounts(t) {
    const errors = [];
    await Promise.all(SITE_ORDER.map(async (site) => {
      try {
        const p = await A.lookupAccount(site, state.q);
        if (t !== state.token || !p) return;
        state.results.push(Object.assign({ kind: "account" }, p));
        state.results.sort((a, b) => SITE_ORDER.indexOf(a.site) - SITE_ORDER.indexOf(b.site));
        render();
      } catch (e) {
        if (t !== state.token) return;
        if (e.login) { state.results.push({ kind: "login", site }); render(); }
        else if (!/introuvable|404/i.test(e.message)) errors.push(P.SITES[site] + " : " + e.message);
      }
    }));
    if (t !== state.token) return;
    state.loading = false;
    if (!state.results.some((r) => r.kind === "account") && errors.length) state.error = "Recherche incomplète. " + errors.join(" · ");
    render();
  }

  async function run(more) {
    if (state.mode !== "list") {
      const q = $("sQuery").value.trim();
      if (!q) return;
      if (!more) state.q = q;
    }
    const t = ++state.token;
    if (!more) { state.page = 1; state.results = []; state.next = false; state.note = ""; }
    else state.page++;
    state.loading = true;
    state.error = "";
    render();
    if (state.mode === "accounts") return runAccounts(t);
    try {
      let r;
      if (state.mode === "list") r = await state.list.sections[state.list.section].load(state.page);
      else {
        if (state.site === "wattpad") r = await wattpadPrecise(t, more);
        else {
          const url = S.url(state.site, state.q, opts(), state.page);
          r = S.parse(state.site, await A.download(url, state.site, S.readySelector(state.site)));
        }
      }
      if (t !== state.token) return;
      const fresh = r.results.filter((x) => !state.results.some((y) => keyOf(y) === keyOf(x)));
      state.results.push(...fresh);
      state.next = r.next && fresh.length > 0;
      state.loading = false;
      render();
      translateSummaries(fresh, t);
    } catch (e) {
      if (t !== state.token) return;
      state.loading = false;
      state.error = "Chargement impossible : " + e.message;
      if (more) state.page--;
      render();
    }
  }

  // Wattpad renvoie des résultats approximatifs : on filtre strictement et on trie ici,
  // en lisant jusqu'à 4 pages pour avoir assez de résultats vraiment pertinents.
  let wpWorking = 0; // adresse de recherche Wattpad qui a répondu la dernière fois
  async function wattpadPage(apiQuery, page) {
    const urls = S.wattpadUrls(apiQuery, page);
    const order = [wpWorking, ...urls.keys()].filter((v, i, a) => a.indexOf(v) === i);
    let last = null;
    for (const k of order) {
      try {
        const body = await A.download(urls[k], "wattpad");
        if (!Array.isArray(JSON.parse(body).stories)) throw new Error("réponse inattendue de Wattpad");
        wpWorking = k;
        return S.parse("wattpad", body);
      } catch (e) { last = e; }
    }
    throw last;
  }

  // Plusieurs requêtes en parallèle (texte, tags), fusion, puis filtrage strict et tri ici.
  async function wattpadPrecise(t, more) {
    const f = { language: $("wLang").value, complete: $("wComplete").checked, noMature: !$("wMature").checked };
    const queries = S.wattpadQueries(state.q);
    // Texte : adresse du site + ancienne adresse (v3, celle qui a déjà marché) ; tags : v4/stories.
    const jobs = [];
    queries.forEach((q, k) => {
      if (k === 0) { jobs.push([q, null]); jobs.push([q, 2]); } else jobs.push([q, null]);
    });
    const raw = [], seen = new Set();
    let next = false, errors = 0;
    for (let i = 0; i < 2; i++) {
      if (i) state.page++;
      const pages = await Promise.all(jobs.map(([q, k]) => (k == null ? wattpadPage(q, state.page)
        : A.download(S.wattpadUrls(q, state.page)[k], "wattpad").then((b) => S.parse("wattpad", b))).catch(() => { errors++; return null; })));
      if (t !== state.token) return { results: [], next: false };
      next = false;
      for (const r of pages) if (r) {
        next = next || r.next;
        for (const x of r.results) if (!seen.has(x.url)) { seen.add(x.url); raw.push(x); }
      }
      if (!next || S.refine(raw, state.q, f).length >= 20) break;
    }
    if (!raw.length && errors) throw new Error("Wattpad ne répond pas à la recherche.");
    f.stats = {};
    const exact = S.refine(raw, state.q, f);
    const filtered = f.stats.filtered || 0;
    const words = S.parseQuery(state.q).words.length;
    // Pages suivantes : uniquement ce qui contient tous les mots (jamais de « proches » mêlés aux bons).
    if (more) return { results: exact, next };
    const near = !exact.length && words > 1 ? S.refine(raw, state.q, f, Math.ceil(words / 2)) : [];
    const excl = filtered ? ` ${filtered} écartées par tes filtres (langue, terminées, mature).` : "";
    state.note = exact.length ? `Wattpad : ${raw.length} reçues, ${exact.length} contiennent tous les mots.${excl}`
      : near.length ? `Aucune ne contient tous les mots (${raw.length} reçues).${excl} Résultats proches :`
      : `Wattpad a renvoyé ${raw.length} histoires, aucune ne correspond.${excl}`;
    return { results: exact.length ? exact : near, next };
  }

  function info(r) {
    const o = {};
    for (const k of ["url", "site", "title", "author", "fandoms", "relationships", "characters", "tags", "warnings", "rating",
      "language", "words", "chapters", "chaptersTotal", "complete", "published", "updated", "kudos", "series", "summary", "authorUrl"]) o[k] = r[k];
    return o;
  }

  // ------------------------------------------------------------ modes

  function layout() {
    const list = state.mode === "list";
    $("sQuery").hidden = $("sGo").hidden = list;
    $("sTitle").hidden = !list;
    $("sTitle").textContent = list ? state.list.title : "";
    document.querySelector("#searchView .sopts").hidden = list;
    $("sSections").hidden = !list || state.list.sections.length < 2;
    $("sSite").hidden = state.mode !== "stories";
    $("sAo3Opts").hidden = state.mode !== "stories" || state.site !== "ao3";
    $("sWpOpts").hidden = state.mode !== "stories" || state.site !== "wattpad";
    $("sHelp").hidden = state.mode !== "stories" || state.site !== "wattpad";
    for (const x of $("sMode").children) x.classList.toggle("on", x.dataset.mode === state.mode);
    $("sQuery").placeholder = state.mode === "accounts" ? "Pseudo d'un compte…" : "Chercher une fanfic…";
    if (list) {
      $("sSections").innerHTML = state.list.sections.map((s, i) =>
        `<button data-sec="${i}" class="${i === state.list.section ? "on" : ""}">${esc(s.label)}</button>`).join("");
    }
  }

  // Page de profil : sections = [{label, load(page) -> {results, next}, empty}]
  const history = []; // écrans précédents (Retour revient à la recherche ou au profil d'avant)
  const SNAP = ["mode", "q", "page", "results", "next", "error", "list"];

  function openList(opt) {
    if (!$("searchView").hidden) {
      const snap = {};
      for (const k of SNAP) snap[k] = state[k];
      snap.scroll = $("sResults").scrollTop;
      snap.query = $("sQuery").value;
      history.push(snap);
    } else history.length = 0;
    state.mode = "list";
    state.list = Object.assign({ section: 0 }, opt);
    state.results = [];
    layout();
    $("searchView").hidden = false;
    $("sResults").scrollTop = 0;
    run(false);
  }

  const favorites = () => A.authors.slice().sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }))
    .map((a) => Object.assign({ kind: "author" }, a));

  function open(mode) {
    history.length = 0;
    state.mode = mode === "accounts" ? "accounts" : "stories";
    state.q = "";
    state.results = state.mode === "accounts" ? favorites() : [];
    state.error = "";
    state.loading = false;
    state.token++;
    $("sQuery").value = "";
    layout();
    $("searchView").hidden = false;
    render();
    setTimeout(() => $("sQuery").focus(), 50);
  }

  function close() {
    if ($("searchView").hidden) return false;
    state.token++;
    const prev = history.pop();
    if (prev) {
      for (const k of SNAP) state[k] = prev[k];
      state.loading = false;
      $("sQuery").value = prev.query;
      layout();
      render();
      $("sResults").scrollTop = prev.scroll;
      return true;
    }
    $("searchView").hidden = true;
    A.render();
    return true;
  }

  // ------------------------------------------------------------ événements

  $("sBack").addEventListener("click", close);
  $("sGo").addEventListener("click", () => run(false));
  $("sQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.target.blur(); run(false); } });
  $("sQuery").addEventListener("input", (e) => {
    if (state.mode === "accounts" && !e.target.value.trim() && state.q) {
      state.token++; state.q = ""; state.loading = false; state.error = ""; state.results = favorites(); render();
    }
  });
  $("sMode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === state.mode) return;
    const q = $("sQuery").value;
    open(b.dataset.mode);
    $("sQuery").value = q;
    if (q.trim()) run(false);
  });
  $("sSite").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-site]");
    if (!b) return;
    state.site = b.dataset.site;
    for (const x of $("sSite").children) x.classList.toggle("on", x === b);
    layout();
    if (state.q) run(false);
  });
  $("sSections").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sec]");
    if (!b || !state.list) return;
    state.list.section = +b.dataset.sec;
    layout();
    run(false);
  });
  for (const id of ["sLang", "sSort", "sComplete", "wLang", "wComplete", "wMature"]) $(id).addEventListener("change", () => { if (state.q) run(false); });

  $("sResults").addEventListener("click", (e) => {
    const x = e.target.closest("[data-x]");
    if (x) {
      const news = A.settings.news || [];
      if (x.dataset.x === "clear") news.length = 0;
      else {
        const k = +x.closest("[data-n]").dataset.n;
        const item = news[k];
        news.splice(k, 1);
        if (x.dataset.x !== "dismiss") {
          A.addLinks(item.url, "toread", "");
          const f = A.findStory(item.url);
          if (x.dataset.x === "read" && f) A.openReader(f.id);
        }
      }
      A.save();
      A.render(); // pastille du bouton « Auteurs »
      render();
      return;
    }
    const b = e.target.closest("[data-s]");
    if (!b) return;
    if (b.dataset.s === "more") return run(true);
    if (b.dataset.s === "hero") { state.list.onHero(b.dataset.act); render(); return; }
    const r = state.results[+b.closest("[data-i]").dataset.i];
    switch (b.dataset.s) {
      case "add": A.addFromInfo(info(r)); A.toast("Ajoutée à ta liste."); render(); break;
      case "detail": A.openDetail(inList(r).id); break;
      case "read": A.openReader(A.addFromInfo(info(r)).id); render(); break;
      case "orig": r.showOrig = true; render(); break;
      case "tr": r.showOrig = false; render(); break;
      case "fav": A.toggleAuthor(r); render(); break;
      case "profile": A.openProfile(r); break;
      case "author": A.openProfile(P.authorProfile(r)); break;
      case "login": Android.login(LOGIN_URL[r.site]); break;
    }
  });

  // Retour de la page de connexion : on relance la recherche de compte.
  window.__loginDone = () => {
    if (!$("searchView").hidden && state.mode === "accounts" && state.q) { $("sQuery").value = state.q; run(false); }
  };

  A.backHandlers.push(close);
  A.openSearch = open;
  A.openList = openList;
  A.refreshSearch = render;
})();
