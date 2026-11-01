// Comptes et auteurs : importer les favoris d'un compte à partir de son lien, garder ses auteurs favoris,
// voir les histoires d'un auteur.
(function () {
  "use strict";
  const A = window.FanficsApp;
  const P = window.Parsers;
  const PR = P.Profiles;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Télécharge la première adresse qui répond vraiment (les autres : 404, 400 ou erreur Wattpad).
  // L'adresse qui a marché est retenue pour les fois suivantes.
  const working = {};
  async function firstOk(urls, site, ready) {
    const key = site + ":" + urls.map((u) => u.replace(/\/users\/[^/]+/, "/users/*").split("?")[0]).join("|");
    const order = working[key] != null ? [urls[working[key]], ...urls.filter((_, i) => i !== working[key])] : urls;
    let last = null;
    for (const u of order) {
      try {
        const body = await A.download(u, site, ready);
        if (site === "wattpad" && PR.wattpadError(body)) { last = new Error("Réponse inattendue de Wattpad."); continue; }
        working[key] = urls.indexOf(u);
        return body;
      } catch (e) {
        last = e;
        if (!/introuvable|404|400|répondu 4/i.test(e.message)) throw e;
      }
    }
    throw last || new Error("Aucune adresse ne répond.");
  }
  const pageUrls = (pg) => [pg.url, ...(pg.alts || [])];

  const SOURCE = { ffn: "Favoris FanFiction.net", ao3: "Marque-pages AO3", wattpad: "Listes Wattpad" };
  const WHAT = {
    ffn: "ses histoires favorites et ses auteurs favoris",
    ao3: "ses marque-pages (AO3 ne montre pas les auteurs suivis : ils sont privés)",
    wattpad: "ses listes de lecture et les auteurs suivis",
  };

  // ------------------------------------------------------------ lien de profil reçu

  const waiting = [];
  function askProfile(profiles) {
    waiting.push(...profiles);
    if ($("profileSheet").hidden) next();
  }

  function next() {
    const p = waiting[0];
    if (!p) { $("profileSheet").hidden = true; return; }
    const site = P.SITES[p.site];
    $("pfTitle").textContent = `Profil ${site}${p.name ? " : " + p.name : ""}`;
    $("pfHint").textContent = "C'est ton compte, ou un auteur que tu aimes ?";
    $("pfMine").textContent = `C'est mon compte : importer ${WHAT[p.site]}`;
    $("profileSheet").hidden = false;
  }

  $("pfMine").addEventListener("click", () => {
    const p = waiting.shift();
    next();
    if (p) importAccount(p);
  });
  $("pfAuthor").addEventListener("click", () => {
    const p = waiting.shift();
    next();
    if (!p) return;
    A.toast(A.addAuthor(p) ? `${p.name || "Auteur"} ajouté à tes auteurs favoris.` : "Déjà dans tes auteurs favoris.");
    A.render();
  });
  $("profileSheet").addEventListener("click", (e) => {
    if (e.target === $("profileSheet") || e.target.hasAttribute("data-close")) { waiting.length = 0; $("profileSheet").hidden = true; }
  });

  // ------------------------------------------------------------ import des favoris

  let importing = false;

  async function importAccount(p) {
    if (importing) { A.toast("Un import est déjà en cours."); return; }
    importing = true;
    const label = SOURCE[p.site];
    let added = 0, known = 0, newAuthors = 0;
    const errors = [];
    try {
      for (let page = 1; page <= 100; page++) {
        const pages = PR.favoritePages(p, page);
        if (!pages.length) break;
        let more = false;
        for (const pg of pages) {
          A.showProgress(`Import des favoris ${P.SITES[p.site]}…${page > 1 ? " page " + page : ""} (${added} ajoutée${added > 1 ? "s" : ""})`);
          let r;
          try {
            r = PR.parseFavorites(p, pg.kind, await firstOk(pageUrls(pg), p.site, PR.readySelector(p.site)));
          } catch (e) {
            errors.push((pg.kind === "authors" ? "auteurs suivis : " : "") + e.message);
            continue;
          }
          if (r.owner && !p.name) p.name = r.owner;
          for (const info of r.stories) {
            const cur = A.findStory(info.url);
            if (cur) {
              known++;
              if (!(cur.shelves || []).includes(label)) cur.shelves = [...(cur.shelves || []), label];
              cur.fav = true;
            } else {
              A.addFromInfo(Object.assign({}, info, { fav: true, shelves: [label] }), "toread", true);
              added++;
            }
          }
          for (const a of r.authors) if (A.addAuthor(a)) newAuthors++;
          A.render();
          more = more || r.next;
        }
        if (!more) break;
        await sleep(1500); // AO3 limite le nombre de pages par minute
      }
    } finally {
      importing = false;
      A.showProgress("");
    }
    const acc = A.settings.accounts.find((x) => x.url === p.url);
    if (acc) Object.assign(acc, { name: p.name || acc.name, syncedAt: Date.now() });
    else A.settings.accounts.push({ site: p.site, id: p.id, name: p.name, url: p.url, syncedAt: Date.now() });
    A.save();
    A.render();
    const parts = [`${added} histoire${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""}`];
    if (known) parts.push(`${known} déjà dans ta liste`);
    if (p.site !== "ao3") parts.push(`${newAuthors} auteur${newAuthors > 1 ? "s" : ""} ajouté${newAuthors > 1 ? "s" : ""}`);
    A.toast(parts.join(", ") + (errors.length ? ". Problème : " + errors[0] : "."));
    if (added) { A.view.tab = "fav"; A.render(); }
    if (A.refreshSearch && !document.getElementById("searchView").hidden) A.refreshSearch();
  }

  // ------------------------------------------------------------ comptes dans le menu

  function renderAccounts() {
    const list = A.settings.accounts;
    $("accounts").innerHTML = list.length ? list.map((a, i) => `<div class="acc" data-acc="${i}">
        <span>${esc(a.name || a.id)}<small>${esc(P.SITES[a.site])}${a.syncedAt ? " · importé le " + new Date(a.syncedAt).toLocaleDateString("fr-FR") : ""}</small></span>
        <button class="primary" data-ac="sync">Synchroniser</button><button class="ghost" data-ac="remove">✕</button>
      </div>`).join("") : "";
  }
  $("btnMenu").addEventListener("click", renderAccounts);
  $("accounts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ac]");
    if (!b) return;
    const i = +b.closest("[data-acc]").dataset.acc;
    const a = A.settings.accounts[i];
    if (b.dataset.ac === "sync") {
      for (const s of document.querySelectorAll(".sheet")) s.hidden = true;
      importAccount(Object.assign({}, a));
    } else if (confirm(`Oublier le compte ${a.name || a.id} ? Les histoires déjà importées restent dans ta liste.`)) {
      A.settings.accounts.splice(i, 1);
      A.save();
      renderAccounts();
    }
  });

  // ------------------------------------------------------------ chercher un compte par son pseudo

  async function lookupAccount(site, name) {
    const url = PR.lookupUrl(site, name);
    const body = await A.download(url, site, site === "ffn" ? "#content_wrapper_inner" : "");
    return PR.parseLookup(site, name, body);
  }

  function toggleAuthor(p) {
    const i = A.authors.findIndex((a) => a.site === p.site && a.id === p.id);
    if (i >= 0) { A.markAuthorDeleted(A.authors[i]); A.authors.splice(i, 1); A.save(); A.toast(`${p.name} retiré de tes auteurs favoris.`); }
    else { A.addAuthor(p); A.toast(`${p.name} ajouté à tes auteurs favoris.`); }
    A.render();
  }

  // ------------------------------------------------------------ page d'un compte : tout ce qui est public

  const asAuthors = (list) => list.map((a) => Object.assign({ kind: "author" }, a));

  function sections(p) {
    if (p.site === "ffn") {
      let page = null; // une seule page de profil contient tout
      const get = () => (page = page || A.download(p.url, "ffn", PR.readySelector("ffn")).catch((e) => { page = null; throw e; }));
      return [
        { label: "Ses histoires", empty: "Aucune histoire publiée.", load: async () => PR.parseWorks(p, await get()) },
        { label: "Ses favoris", empty: "Aucune histoire favorite publique.", load: async () => ({ results: PR.parseFavorites(p, "both", await get()).stories, next: false }) },
        { label: "Auteurs favoris", empty: "Aucun auteur favori public.", load: async () => ({ results: asAuthors(PR.parseFavorites(p, "both", await get()).authors), next: false }) },
      ];
    }
    if (p.site === "ao3") {
      return [
        { label: "Ses œuvres", empty: "Aucune œuvre publiée.", load: async (n) => PR.parseWorks(p, await A.download(PR.worksUrl(p, n), "ao3")) },
        { label: "Marque-pages", empty: "Aucun marque-page public.", load: async (n) => {
          const r = PR.parseFavorites(p, "stories", await A.download(PR.favoritePages(p, n)[0].url, "ao3"));
          return { results: r.stories, next: r.next };
        } },
      ];
    }
    const [lists, following] = PR.favoritePages(p, 1);
    return [
      { label: "Ses histoires", empty: "Aucune histoire publiée.", load: async (n) => PR.parseWorks(p, await firstOk(PR.worksUrls(p, n), "wattpad")) },
      { label: "Listes de lecture", empty: "Aucune liste publique.", load: async () => ({ results: PR.parseFavorites(p, "stories", await firstOk(pageUrls(lists), "wattpad")).stories, next: false }) },
      { label: "Comptes suivis", empty: "Ne suit personne publiquement.", load: async () => ({ results: asAuthors(PR.parseFavorites(p, "authors", await firstOk(pageUrls(following), "wattpad")).authors), next: false }) },
    ];
  }

  function hero(p) {
    const fav = A.authors.some((a) => a.site === p.site && a.id === p.id);
    const mine = A.settings.accounts.some((a) => a.site === p.site && a.id === p.id);
    const stats = (p.stats || []).map(([n, l]) => `<span class="b">${A.fmt(n)} ${esc(A.plural(n, l))}</span>`).join("");
    return `<section class="hero">
      ${A.avatar(p.name, p.site, "lg")}
      <h2>${esc(p.name)}</h2>
      <div class="badges center"><span class="b site-${p.site}">${esc(P.SITES[p.site])}</span>${stats}</div>
      ${p.joined ? `<div class="hint">Membre depuis ${esc(p.joined)}</div>` : ""}
      ${p.bio ? `<div class="ssum hero-bio">${esc(p.bio)}</div>` : ""}
      ${p.site === "ao3" ? `<div class="hint">Les auteurs suivis sur AO3 sont privés : seuls les œuvres et marque-pages sont visibles.</div>` : ""}
      <div class="actions center">
        <button class="${mine ? "ghost" : "primary"}" data-s="hero" data-act="import">${mine ? "⟳ Resynchroniser mes favoris" : "C'est moi : importer mes favoris"}</button>
        <button class="ghost" data-s="hero" data-act="fav">${fav ? "✓ Auteur favori" : "☆ Auteur favori"}</button>
        <button class="ghost" data-s="hero" data-act="site">Sur le site</button>
      </div>
    </section>`;
  }

  function openProfile(p) {
    p = { site: p.site, id: p.id, name: p.name || p.id, url: p.url, bio: p.bio, joined: p.joined, stats: p.stats };
    A.openList({
      title: p.name,
      sections: sections(p),
      hero: () => hero(p),
      onHero: (act) => {
        if (act === "import") importAccount(Object.assign({}, p));
        else if (act === "fav") toggleAuthor(p);
        else if (act === "site") A.native ? Android.open(p.url) : window.open(p.url, "_blank");
      },
    });
  }

  // ------------------------------------------------------------ nouveautés trouvées en arrière-plan (notifications)

  // events : [{kind: "chapters"|"story", site, url, title, author, chapters, added, t}]
  function applyUpdates(events) {
    if (!events || !events.length) return;
    let chapters = 0, stories = 0;
    const news = A.settings.news || (A.settings.news = []);
    for (const e of events) {
      const f = A.findStory(e.url);
      if (e.kind === "chapters" && f) {
        if (!f.chapters || e.chapters > f.chapters) {
          f.newChapters = (f.newChapters || 0) + (e.added || e.chapters - (f.chapters || 0));
          f.chapters = e.chapters;
          if (f.chaptersTotal != null && f.chaptersTotal < f.chapters) f.chaptersTotal = null;
          chapters++;
        }
      } else if (!f && !news.some((x) => P.storyKey(x.url) === P.storyKey(e.url))) {
        news.unshift({ url: e.url, site: e.site, title: e.title, author: e.author, chapters: e.chapters, kind: e.kind, t: e.t });
        stories++;
      }
    }
    news.splice(30);
    A.save();
    A.render();
    if (chapters || stories) {
      A.toast([chapters && `${chapters} fanfic${chapters > 1 ? "s" : ""} avec de nouveaux chapitres`,
        stories && `${stories} nouveauté${stories > 1 ? "s" : ""} de tes auteurs`].filter(Boolean).join(" · "));
      if (chapters) { A.view.tab = "new"; A.render(); }
    }
    if (A.refreshSearch && !$("searchView").hidden) A.refreshSearch();
  }

  function pullUpdates() {
    if (!A.native || typeof Android.takeUpdates !== "function") return;
    try { applyUpdates(JSON.parse(Android.takeUpdates())); } catch (e) { /* rien de lisible */ }
  }
  window.__resume = pullUpdates;

  function setNotify(on) {
    A.settings.notify = on;
    A.save();
    if (A.native && typeof Android.setNotify === "function") Android.setNotify(on);
  }
  $("setNotify").addEventListener("change", (e) => setNotify(e.target.checked));
  $("btnMenu").addEventListener("click", () => { $("setNotify").checked = A.settings.notify !== false; });
  $("mCheckNow").addEventListener("click", async () => {
    if (!A.native) { A.toast("La vérification en arrière-plan ne marche que dans l'app Android."); return; }
    A.toast("Vérification de tes auteurs et fanfics en cours…");
    try {
      await A.nativeCall("checkUpdates");
      const ev = JSON.parse(Android.takeUpdates());
      if (ev.length) applyUpdates(ev); else A.toast("Rien de nouveau pour l'instant.");
    } catch (e) { A.toast(e.message); }
  });
  if (A.native) setTimeout(() => { setNotify(A.settings.notify !== false); pullUpdates(); }, 300);

  A.applyUpdates = applyUpdates;
  A.askProfile = askProfile;
  A.importAccount = importAccount;
  A.lookupAccount = lookupAccount;
  A.openProfile = openProfile;
  A.openAuthor = openProfile;
  A.toggleAuthor = toggleAuthor;
})();
