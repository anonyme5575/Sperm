// Recherche de fanfics sur AO3, FanFiction.net et Wattpad, sans quitter l'app.
(function () {
  "use strict";
  const A = window.FanficsApp;
  const P = window.Parsers;
  const S = P.Search;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;

  const state = { site: "ao3", q: "", page: 1, results: [], next: false, token: 0, loading: false };

  function opts() {
    return state.site === "ao3" ? { language: $("sLang").value, sort: $("sSort").value, complete: $("sComplete").checked } : {};
  }

  function inList(r) { return A.fics.find((f) => f.url === r.url); }

  function card(r, i) {
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
    return `<article class="card sres" data-i="${i}">
      <div class="t">${esc(r.title)}</div>
      <div class="a">${r.author ? "par " + esc(r.author) : ""}</div>
      ${r.fandoms && r.fandoms.length ? `<div class="f">${esc(r.fandoms.slice(0, 3).join(" · "))}</div>` : ""}
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

  function render() {
    const box = $("sResults");
    let html = state.results.map(card).join("");
    if (state.loading) html += `<p class="rwait">Recherche…${state.site === "ffn" ? "<br><small>FanFiction.net peut prendre quelques secondes.</small>" : ""}</p>`;
    else if (state.error) html += `<p class="rwait">${esc(state.error)}</p>`;
    else if (state.q && !state.results.length) html += `<p class="rwait">Aucun résultat.</p>`;
    else if (state.next) html += `<div class="actions" style="justify-content:center"><button class="ghost" data-s="more">Plus de résultats</button></div>`;
    if (!state.q && !state.results.length && !state.loading) html = `<p class="rwait">Tape un titre, un fandom, un personnage, un couple ou un tag.<br><small>Ex. « Drarry slow burn », « Naruto », « enemies to lovers ».</small></p>`;
    box.innerHTML = html;
  }

  // Traduit les résumés des résultats qui ne sont pas dans la langue choisie (une seule série de requêtes).
  async function translateSummaries(items, t) {
    if (!A.settings.autoTranslate) return;
    const todo = items.filter((r) => r.summary && !A.translate.sameLanguage(r.language));
    if (!todo.length) return;
    try {
      const tr = await A.translate.paragraphs(todo.map((r) => r.summary.replace(/\s*\n+\s*/g, " ")), null);
      if (t !== state.token || !tr) return;
      todo.forEach((r, i) => { if (tr[i] && tr[i] !== r.summary) r.summaryTr = tr[i]; });
      render();
    } catch (e) { /* résumés laissés en version originale */ }
  }

  async function run(more) {
    const q = $("sQuery").value.trim();
    if (!q) return;
    const t = ++state.token;
    if (!more) { state.q = q; state.page = 1; state.results = []; state.next = false; }
    else state.page++;
    state.loading = true;
    state.error = "";
    render();
    try {
      const url = S.url(state.site, state.q, opts(), state.page);
      const body = await A.download(url, state.site, S.readySelector(state.site));
      if (t !== state.token) return;
      const r = S.parse(state.site, body);
      const fresh = r.results.filter((x) => !state.results.some((y) => y.url === x.url));
      state.results.push(...fresh);
      state.next = r.next && fresh.length > 0;
      state.loading = false;
      render();
      translateSummaries(fresh, t);
    } catch (e) {
      if (t !== state.token) return;
      state.loading = false;
      state.error = "Recherche impossible : " + e.message;
      if (more) state.page--;
      render();
    }
  }

  function info(r) {
    const o = {};
    for (const k of ["url", "site", "title", "author", "fandoms", "relationships", "characters", "tags", "warnings", "rating",
      "language", "words", "chapters", "chaptersTotal", "complete", "published", "updated", "kudos", "series", "summary"]) o[k] = r[k];
    return o;
  }

  function open() {
    $("searchView").hidden = false;
    render();
    setTimeout(() => $("sQuery").focus(), 50);
  }

  function close() {
    if ($("searchView").hidden) return false;
    $("searchView").hidden = true;
    A.render();
    return true;
  }

  // ------------------------------------------------------------ événements

  $("sBack").addEventListener("click", close);
  $("sGo").addEventListener("click", () => run(false));
  $("sQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.target.blur(); run(false); } });
  $("sSite").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-site]");
    if (!b) return;
    state.site = b.dataset.site;
    for (const x of $("sSite").children) x.classList.toggle("on", x === b);
    $("sAo3Opts").hidden = state.site !== "ao3";
    if (state.q) run(false);
  });
  for (const id of ["sLang", "sSort", "sComplete"]) $(id).addEventListener("change", () => { if (state.q) run(false); });

  $("sResults").addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    if (b.dataset.s === "more") return run(true);
    const r = state.results[+b.closest("[data-i]").dataset.i];
    switch (b.dataset.s) {
      case "add": A.addFromInfo(info(r)); A.toast("Ajoutée à ta liste."); render(); break;
      case "detail": A.openDetail(inList(r).id); break;
      case "read": A.openReader(A.addFromInfo(info(r)).id); render(); break;
      case "orig": r.showOrig = true; render(); break;
      case "tr": r.showOrig = false; render(); break;
    }
  });

  A.backHandlers.push(close);
  A.openSearch = open;
})();
