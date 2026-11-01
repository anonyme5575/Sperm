// Lecteur : chapitres lus dans l'app, traduits automatiquement, position retenue.
(function () {
  "use strict";
  const A = window.FanficsApp;
  const P = window.Parsers;
  const C = P.Chapters;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;

  let fic = null;
  let list = null;      // [{title, url}]
  let n = 1;            // chapitre affiché (à partir de 1)
  let token = 0;        // évite qu'une réponse ancienne écrase le chapitre affiché
  let original = null;  // {title, paragraphs}
  let translated = null;
  let showOriginal = false;
  const inflight = {};  // téléchargements de chapitres en cours (url -> Promise)

  // ------------------------------------------------------------ données

  const listKey = (f) => "list:" + f.url;

  async function ensureList(f) {
    f = f || fic;
    const known = A.cacheGet(listKey(f));
    const count = f.chaptersTotal || f.chapters || 0;
    if (known && known.length && known.length >= count) return known;
    if (P.siteOf(f.url) === "ffn") {
      // FanFiction.net : adresses devinables ; on garde les titres déjà connus.
      const base = C.initialList(f.url, f.title, Math.max(count, known ? known.length : 0));
      return base.map((c, i) => (known && known[i]) || c);
    }
    const url = C.listUrl(f.url);
    if (!url) return C.initialList(f.url, f.title, count);
    const l = C.parseList(f.url, await A.download(url, f.site));
    A.cachePut(listKey(f), l);
    return l;
  }

  function chapterData(url, f) {
    f = f || fic;
    const cached = A.cacheGet("ch:" + url);
    if (cached) return Promise.resolve(cached);
    if (inflight[url]) return inflight[url];
    const ficUrl = f.url;
    inflight[url] = A.download(url, P.siteOf(url), C.readySelector(url)).then((body) => {
      const r = C.parseChapter(url, body);
      if (r.list) {
        const old = (fic && fic.url === ficUrl && list) || A.cacheGet("list:" + ficUrl) || [];
        const l = r.list.map((c, i) => ({ title: c.title || (old[i] && old[i].title) || "", url: c.url }));
        A.cachePut("list:" + ficUrl, l);
        if (fic && fic.url === ficUrl) list = l;
      }
      const d = { title: r.title, paragraphs: r.paragraphs };
      A.cachePut("ch:" + url, d);
      return d;
    }).finally(() => { delete inflight[url]; });
    return inflight[url];
  }

  function wantsTranslation(f) {
    f = f || fic;
    return A.settings.autoTranslate && !A.translate.sameLanguage(f.language);
  }

  // onChunk([{i, t}]) : i = 0 pour le titre, i = k + 1 pour le paragraphe k.
  function translateChapter(url, d, onChunk) {
    const parts = [d.title || "", ...d.paragraphs];
    return A.translate.paragraphs(parts, "ch:" + url, onChunk).then((t) => (t ? { title: t[0], paragraphs: t.slice(1) } : null));
  }
  const asChapter = (t) => (t ? { title: t[0], paragraphs: t.slice(1) } : t);

  // ------------------------------------------------------------ affichage

  function chapterTitle(i) {
    const c = list && list[i - 1];
    return c && c.title ? c.title : "Chapitre " + i;
  }

  function header() {
    $("rFic").textContent = fic.title;
    $("rCh").textContent = list ? `Chapitre ${n}/${list.length}` : "";
    $("rList").innerHTML = (list || []).map((c, i) =>
      `<option value="${i + 1}"${i + 1 === n ? " selected" : ""}>${i + 1}. ${esc(c.title && !/^Chapitre \d+$/.test(c.title) ? c.title.replace(/^\d+\.\s*/, "") : "Chapitre " + (i + 1))}</option>`).join("");
    $("rPrev").disabled = n <= 1;
    $("rNext").disabled = !list || n >= list.length;
  }

  function banner(html) {
    $("rBanner").hidden = !html;
    $("rBanner").innerHTML = html || "";
  }

  function showText(d, scrollTo) {
    const body = $("rBody");
    const last = list && n >= list.length;
    body.innerHTML = `<h2>${esc(d.title || chapterTitle(n))}</h2>` +
      d.paragraphs.map((p, k) => (p === "* * *" ? `<p class="sep">* * *</p>` : `<p data-k="${k}">${esc(p)}</p>`)).join("") +
      `<div class="rend">${last ? (fic.complete ? "Fin." : "Dernier chapitre publié pour l'instant.") :
        `<button class="primary" data-r="next">Chapitre suivant ▶</button>`}</div>`;
    if (scrollTo != null) body.scrollTop = scrollTo * Math.max(0, body.scrollHeight - body.clientHeight);
    progress();
  }

  function translationBanner() {
    if (!translated) {
      banner(A.translate.sameLanguage(fic.language) || !original ? "" :
        `Texte original · <button class="link" data-r="translate">Traduire</button>`);
      return;
    }
    banner(showOriginal
      ? `Texte original · <button class="link" data-r="showTr">Voir la traduction</button>`
      : `Traduit automatiquement · <button class="link" data-r="showOrig">Voir l'original</button>`);
  }

  function ratio() {
    const b = $("rBody");
    const h = b.scrollHeight - b.clientHeight;
    return h > 0 ? b.scrollTop / h : 1;
  }

  async function translateNow(t, url, scroll) {
    banner("Traduction…");
    const body = $("rBody");
    let progressed = false;
    // Texte original en attente, en grisé ; chaque paragraphe se remplace dès que sa traduction arrive.
    body.classList.add("translating");
    const onChunk = (ups) => {
      if (t !== token || showOriginal) return;
      if (!progressed) { progressed = true; banner("Traduction en cours… la suite arrive pendant ta lecture"); }
      for (const u of ups) {
        const el = u.i === 0 ? body.querySelector("h2") : body.querySelector(`p[data-k="${u.i - 1}"]`);
        if (el) { if (u.i !== 0 || u.t) el.textContent = u.t; el.classList.add("tr"); }
      }
    };
    try {
      const tr = await translateChapter(url, original, onChunk);
      if (t !== token) return;
      body.classList.remove("translating");
      translated = tr;
      if (tr && !showOriginal && !progressed) showText(tr, scroll != null ? scroll : ratio());
      translationBanner();
    } catch (e) {
      if (t !== token) return;
      body.classList.remove("translating");
      banner(`Traduction impossible : ${esc(e.message)} · <button class="link" data-r="translate">Réessayer</button>`);
    }
  }

  async function load(i, restoreScroll) {
    const t = ++token;
    n = i;
    original = translated = null;
    showOriginal = false;
    fic.readCh = n;
    fic.readAt = Date.now();
    if (fic.status === "toread") fic.status = "reading";
    A.save();
    header();
    banner("");
    $("rBody").innerHTML = `<p class="rwait">Chargement du chapitre ${n}…${fic.site === "ffn" ? "<br><small>FanFiction.net peut prendre quelques secondes.</small>" : ""}</p>`;
    $("rBody").scrollTop = 0;
    const scroll = restoreScroll ? fic.readScroll || 0 : 0;
    try {
      if (!list) list = await ensureList();
      if (t !== token) return;
      if (n > list.length) n = list.length;
      header();
      const url = list[n - 1].url;
      const d = await chapterData(url);
      if (t !== token) return;
      header(); // la liste a pu être complétée par le chapitre (FanFiction.net)
      original = d;
      const ready = wantsTranslation() ? A.translate.cached("ch:" + url) : undefined;
      if (ready) {
        translated = asChapter(ready);
        showText(translated, scroll);
        translationBanner();
      } else {
        showText(d, scroll);
        translationBanner();
        if (wantsTranslation() && ready === undefined) await translateNow(t, url, scroll);
      }
      prefetch(t);
    } catch (e) {
      if (t !== token) return;
      $("rBody").innerHTML = `<p class="rwait">Impossible de charger ce chapitre.<br><small>${esc(e.message)}</small></p>
        <div class="actions" style="justify-content:center"><button class="primary" data-r="retry">Réessayer</button>
        <button class="ghost" data-r="site">Ouvrir sur le site</button></div>`;
    }
  }

  // Prépare le chapitre suivant (et sa traduction) pendant la lecture.
  async function prefetch(t) {
    if (!list || n >= list.length) return;
    const url = list[n].url;
    try {
      const d = await chapterData(url);
      if (t === token && wantsTranslation()) await translateChapter(url, d);
    } catch (e) { /* on réessaiera en l'ouvrant */ }
  }

  // Prépare (télécharge et traduit) le chapitre où l'on reprendra une fanfic, avant même de l'ouvrir.
  // Pas pour FanFiction.net : sa vérification anti-robot pourrait s'afficher sans qu'on ait rien demandé.
  const preparing = new Set();
  async function prepare(f) {
    if (!f || f.site === "ffn" || preparing.has(f.id) || (fic && fic.id === f.id)) return;
    preparing.add(f.id);
    try {
      const l = await ensureList(f);
      const total = l.length;
      const ch = Math.max(1, Math.min(f.readCh || (f.lastRead || 0) + 1, total));
      const url = l[ch - 1].url;
      const d = await chapterData(url, f);
      if (wantsTranslation(f)) await translateChapter(url, d);
    } catch (e) { /* on réessaiera à l'ouverture */ }
    finally { preparing.delete(f.id); }
  }

  // ------------------------------------------------------------ ouverture, fermeture

  function open(id) {
    fic = A.find(id);
    if (!fic) return;
    list = null;
    const total = fic.chaptersTotal || fic.chapters || 0;
    const start = fic.readCh || (fic.lastRead ? Math.min(fic.lastRead + 1, total || fic.lastRead + 1) : 1);
    applyFont();
    $("reader").classList.remove("immersive");
    $("reader").hidden = false;
    load(start, !!fic.readCh && fic.readCh === start);
  }

  function close() {
    if ($("reader").hidden) return false;
    token++;
    saveScroll();
    $("reader").hidden = true;
    A.render();
    fic = null;
    return true;
  }

  const THEMES = [["night", "🌙", "Nuit"], ["sepia", "☕", "Sépia"], ["paper", "☀️", "Papier"]];
  function applyFont() {
    $("rBody").style.fontSize = A.settings.fontSize + "px";
    const t = THEMES.find((x) => x[0] === A.settings.readerTheme) || THEMES[0];
    $("reader").dataset.theme = t[0];
    $("rTheme").textContent = t[1];
    $("rTheme").title = "Ambiance : " + t[2];
  }

  function progress() {
    $("rProg").style.width = (original ? Math.round(ratio() * 100) : 0) + "%";
  }

  let scrollTimer = 0;
  function saveScroll() {
    if (!fic || !original) return;
    fic.readScroll = Math.round(ratio() * 1000) / 1000;
    // Arrivé en bas du chapitre : il compte comme lu.
    if (fic.readScroll > 0.97 && (fic.lastRead || 0) < n) A.setLastRead(fic, n);
    A.save();
  }

  // ------------------------------------------------------------ événements

  $("rBack").addEventListener("click", close);
  $("rPrev").addEventListener("click", () => { if (n > 1) { saveScroll(); load(n - 1); } });
  $("rNext").addEventListener("click", next);
  $("rList").addEventListener("change", (e) => { saveScroll(); load(+e.target.value); });
  $("rSmaller").addEventListener("click", () => { A.settings.fontSize = Math.max(13, A.settings.fontSize - 1); applyFont(); A.save(); });
  $("rBigger").addEventListener("click", () => { A.settings.fontSize = Math.min(30, A.settings.fontSize + 1); applyFont(); A.save(); });
  $("rBody").addEventListener("scroll", () => { progress(); clearTimeout(scrollTimer); scrollTimer = setTimeout(saveScroll, 400); }, { passive: true });
  $("rTheme").addEventListener("click", () => {
    const i = THEMES.findIndex((x) => x[0] === A.settings.readerTheme);
    A.settings.readerTheme = THEMES[(i + 1) % THEMES.length][0];
    applyFont();
    A.save();
  });
  // Toucher le texte (hors bouton) : masque ou montre les barres, pour lire en plein écran.
  $("rBody").addEventListener("click", (e) => {
    if (e.target.closest("button, a, select") || window.getSelection().toString()) return;
    $("reader").classList.toggle("immersive");
  });

  function next() {
    if (!list || n >= list.length) return;
    if ((fic.lastRead || 0) < n) A.setLastRead(fic, n);
    load(n + 1);
  }

  $("reader").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    const act = b.dataset.r;
    if (act === "next") next();
    else if (act === "retry") load(n);
    else if (act === "site") A.native ? Android.open(fic.url) : window.open(fic.url, "_blank");
    else if (act === "showOrig") { showOriginal = true; showText(original, ratio()); translationBanner(); }
    else if (act === "showTr") { showOriginal = false; showText(translated, ratio()); translationBanner(); }
    else if (act === "translate" && original) translateNow(token, list[n - 1].url, ratio());
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden && fic) saveScroll(); });

  A.backHandlers.push(close);
  A.prepareRead = prepare;
  A.openReader = open;
})();
