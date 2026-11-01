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
            r = PR.parseFavorites(p, pg.kind, await A.download(pg.url, p.site, PR.readySelector(p.site)));
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

  // ------------------------------------------------------------ histoires d'un auteur

  function openAuthor(a) {
    A.openList(`${a.name} · ${P.SITES[a.site]}`, async (page) => {
      const url = PR.worksUrl(a, page);
      if (!url) return { results: [], next: false };
      return PR.parseWorks(a, await A.download(url, a.site, PR.readySelector(a.site)));
    });
  }

  A.askProfile = askProfile;
  A.importAccount = importAccount;
  A.openAuthor = openAuthor;
})();
