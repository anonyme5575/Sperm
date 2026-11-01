// Tests de Mes Fanfics dans Chromium (Playwright) :
//   node fanfics/tests/test.cjs
// 1. Lecture des pages d'exemple (pages/) : AO3, FanFiction.net, Wattpad, site quelconque.
// 2. L'app entière avec un faux pont Android qui sert ces pages au lieu d'Internet.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WEB = path.join(__dirname, "..", "web");
const page = (f) => fs.readFileSync(path.join(__dirname, "pages", f), "utf8");
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log("ok   " + name); }
  catch (e) { failures++; console.log("FAIL " + name + "\n     " + (e.stack || e).toString().split("\n").slice(0, 14).join("\n     ")); }
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- lecteurs de pages
  const p = await browser.newPage();
  await p.addScriptTag({ path: path.join(WEB, "parsers.js") });
  const parse = (url, body) => p.evaluate(([u, b]) => {
    try { return Parsers.parse(u, b); } catch (e) { return { error: e.message }; }
  }, [url, body]);

  await test("liens : extraction, formes canoniques, doublons", async () => {
    const r = await p.evaluate(() => Parsers.extractUrls(`
      Regarde ça https://archiveofourown.org/works/123/chapters/456#workskin !
      et https://archiveofourown.org/works/123?view_adult=true
      (https://m.fanfiction.net/s/999/3/Une-Histoire).
      https://www.wattpad.com/story/555-titre-ici?utm=x
      https://www.wattpad.com/777-chapitre-un
      https://exemple.fr/fic/rien-n-est-eternel.html, pas un lien : www.foo.com`));
    assert.deepStrictEqual(r, [
      "https://archiveofourown.org/works/123",
      "https://www.fanfiction.net/s/999/1/Une-Histoire",
      "https://www.wattpad.com/story/555",
      "https://www.wattpad.com/777",
      "https://exemple.fr/fic/rien-n-est-eternel.html",
    ]);
  });

  await test("liens : titre deviné sans télécharger", async () => {
    const r = await p.evaluate(() => [
      Parsers.fromUrl("https://www.fanfiction.net/s/999/1/The-Long-Road-Home"),
      Parsers.fromUrl("https://archiveofourown.org/works/123"),
      Parsers.fromUrl("https://exemple.fr/fic/rien-n-est-eternel.html"),
      Parsers.fetchUrl("https://archiveofourown.org/works/123"),
    ]);
    assert.deepStrictEqual(r[0], { site: "ffn", title: "The Long Road Home" });
    assert.deepStrictEqual(r[1], { site: "ao3", title: "AO3 n° 123" });
    assert.strictEqual(r[2].title, "Rien n est eternel");
    assert.strictEqual(r[3], "https://archiveofourown.org/works/123?view_adult=true");
  });

  await test("AO3 : fanfic en cours", async () => {
    const r = await parse("https://archiveofourown.org/works/123", page("ao3.html"));
    assert.strictEqual(r.title, "Le Dernier Hiver");
    assert.strictEqual(r.author, "Plume");
    assert.deepStrictEqual(r.fandoms, ["Harry Potter - J. K. Rowling", "Fantastic Beasts and Where to Find Them (Movies)"]);
    assert.deepStrictEqual(r.relationships, ["Hermione Granger/Draco Malfoy"]);
    assert.deepStrictEqual(r.characters, ["Hermione Granger", "Draco Malfoy"]);
    assert.deepStrictEqual(r.tags, ["Slow Burn", "Enemies to Lovers"]);
    assert.strictEqual(r.rating, "Teen And Up Audiences");
    assert.strictEqual(r.language, "Français");
    assert.strictEqual(r.words, 87412);
    assert.strictEqual(r.chapters, 12);
    assert.strictEqual(r.chaptersTotal, null);
    assert.strictEqual(r.complete, false);
    assert.strictEqual(r.published, "2023-02-14");
    assert.strictEqual(r.updated, "2024-10-02");
    assert.strictEqual(r.kudos, 2145);
    assert.strictEqual(r.series, "Part 1 of the Saisons series");
    assert.strictEqual(r.summary, "Après la guerre, Hermione revient à Poudlard.\n\nElle n'est pas la seule.");
  });

  await test("AO3 : fanfic terminée, anonyme, mots avec espace", async () => {
    const r = await parse("https://archiveofourown.org/works/9", page("ao3-complete.html"));
    assert.strictEqual(r.title, "One & Done");
    assert.strictEqual(r.author, "Anonyme");
    assert.strictEqual(r.words, 5000);
    assert.strictEqual(r.complete, true);
    assert.strictEqual(r.chaptersTotal, 3);
    assert.strictEqual(r.updated, "2020-05-05");
  });

  await test("AO3 : fanfic réservée aux membres -> message clair", async () => {
    const r = await parse("https://archiveofourown.org/works/9", page("ao3-restricted.html"));
    assert.match(r.error, /réservée aux membres/);
  });

  await test("FanFiction.net : fiche complète", async () => {
    const r = await parse("https://www.fanfiction.net/s/12345678/1/", page("ffn.html"));
    assert.strictEqual(r.title, "The Long Road Home");
    assert.strictEqual(r.author, "Wanderer");
    assert.deepStrictEqual(r.fandoms, ["Harry Potter"]);
    assert.strictEqual(r.rating, "T");
    assert.strictEqual(r.language, "English");
    assert.deepStrictEqual(r.tags, ["Adventure", "Hurt/Comfort"]);
    assert.deepStrictEqual(r.characters, ["Harry P.", "Ginny W.", "Luna L."]);
    assert.strictEqual(r.words, 156789);
    assert.strictEqual(r.chapters, 24);
    assert.strictEqual(r.complete, true);
    assert.strictEqual(r.kudos, 4567);
    assert.strictEqual(r.updated, "2023-11-14");
    assert.strictEqual(r.published, "2017-07-14");
    assert.strictEqual(r.summary, "Harry finds a way back, but not to the world he left.");
  });

  await test("FanFiction.net : page anti-robot -> message clair", async () => {
    const r = await parse("https://www.fanfiction.net/s/1/1/", page("ffn-cloudflare.html"));
    assert.match(r.error, /anti-robot/);
  });

  await test("FanFiction.net : page normale sans fiche -> pas pris pour un blocage", async () => {
    const r = await parse("https://www.fanfiction.net/s/14403715/1/", page("ffn-autre.html"));
    assert.match(r.error, /non reconnue.*unleash your imagination/);
  });

  await test("FanFiction.net : lien sans titre -> numéro de l'histoire", async () => {
    const r = await p.evaluate(() => Parsers.fromUrl(Parsers.canonical("https://m.fanfiction.net/s/14403715/1/")));
    assert.deepStrictEqual(r, { site: "ffn", title: "FanFiction.net n° 14403715" });
  });

  await test("Wattpad : API", async () => {
    const r = await parse("https://www.wattpad.com/story/18225403", page("wattpad.json"));
    assert.strictEqual(r.title, "Les Étoiles Filantes");
    assert.strictEqual(r.author, "luna_ecrit");
    assert.strictEqual(r.chapters, 42);
    assert.strictEqual(r.chaptersTotal, null);
    assert.strictEqual(r.updated, "2024-08-20");
    assert.deepStrictEqual(r.tags, ["romance", "fanfiction", "bts"]);
  });

  await test("site quelconque : balises de partage", async () => {
    const r = await parse("https://www.fanfictions.fr/fanfictions/one-piece/123/rien.html", page("generic.html"));
    assert.strictEqual(r.title, "Rien n'est éternel");
    assert.strictEqual(r.author, "Mugi");
    assert.strictEqual(r.summary, "Une fanfiction One Piece sur Zoro.");
    assert.strictEqual(r.chapters, null);
  });
  const ev = (fn, ...args) => p.evaluate(fn, ...args);

  await test("chapitres AO3 : liste", async () => {
    const r = await ev((b) => Parsers.Chapters.parseList("https://archiveofourown.org/works/555", b), page("ao3-navigate.html"));
    assert.deepStrictEqual(r, [
      { title: "1. Beginnings", url: "https://archiveofourown.org/works/555/chapters/2001?view_adult=true" },
      { title: "2. The Fall", url: "https://archiveofourown.org/works/555/chapters/2002?view_adult=true" },
    ]);
    assert.strictEqual(await ev(() => Parsers.Chapters.listUrl("https://archiveofourown.org/works/555")),
      "https://archiveofourown.org/works/555/navigate?view_adult=true");
  });

  await test("chapitres AO3 : texte (paragraphes, sauts de ligne, séparateur)", async () => {
    const r = await ev((b) => Parsers.Chapters.parseChapter("https://archiveofourown.org/works/555/chapters/2001?view_adult=true", b), page("ao3-ch1.html"));
    assert.strictEqual(r.title, "Chapter 1: Beginnings");
    assert.deepStrictEqual(r.paragraphs, ["Harry looked at the sky.", "It was dark.", "* * *", "Draco smiled, chapter 1."]);
  });

  await test("chapitres FanFiction.net : texte et liste depuis la page", async () => {
    const r = await ev((b) => Parsers.Chapters.parseChapter("https://www.fanfiction.net/s/12345678/3/", b), page("ffn-ch3.html"));
    assert.strictEqual(r.title, "Return");
    assert.deepStrictEqual(r.paragraphs, ["Chapter three begins.", "Ginny waited."]);
    assert.strictEqual(r.list.length, 24);
    assert.deepStrictEqual(r.list[2], { title: "Return", url: "https://www.fanfiction.net/s/12345678/3/" });
  });

  await test("chapitres Wattpad : parties et texte", async () => {
    const l = await ev((b) => Parsers.Chapters.parseList("https://www.wattpad.com/story/18225403", b), page("wattpad-parts.json"));
    assert.deepStrictEqual(l[1], { title: "Chapitre 1", url: "https://www.wattpad.com/apiv2/storytext?id=902" });
    const c = await ev((b) => Parsers.Chapters.parseChapter("https://www.wattpad.com/apiv2/storytext?id=901", b), page("wattpad-text.html"));
    assert.deepStrictEqual(c.paragraphs, ["Il pleuvait sur Séoul.", "Jimin attendait."]);
  });

  await test("chapitres autre site : le bloc de texte principal", async () => {
    const c = await ev((b) => Parsers.Chapters.parseChapter("https://exemple.fr/fic/1", b), page("generic-chapter.html"));
    assert.strictEqual(c.paragraphs.length, 3);
    assert.match(c.paragraphs[0], /^Zoro se réveilla/);
  });

  await test("recherche AO3 : adresse et résultats", async () => {
    const u = await ev(() => Parsers.Search.url("ao3", "drarry slow", { language: "fr", complete: true, sort: "kudos_count" }, 2));
    assert.strictEqual(u, "https://archiveofourown.org/works/search?work_search%5Bquery%5D=drarry%20slow&work_search%5Blanguage_id%5D=fr&work_search%5Bcomplete%5D=T&work_search%5Bsort_column%5D=kudos_count&work_search%5Bsort_direction%5D=desc&page=2");
    const r = await ev((b) => Parsers.Search.parse("ao3", b), page("ao3-search.html"));
    assert.strictEqual(r.next, true);
    assert.strictEqual(r.results.length, 2);
    const a = r.results[0];
    assert.strictEqual(a.url, "https://archiveofourown.org/works/555");
    assert.strictEqual(a.title, "Stars Fall");
    assert.strictEqual(a.author, "Wren");
    assert.strictEqual(a.rating, "Mature");
    assert.deepStrictEqual(a.relationships, ["Draco Malfoy/Harry Potter"]);
    assert.deepStrictEqual(a.tags, ["Slow Burn"]);
    assert.strictEqual(a.words, 12000);
    assert.strictEqual(a.complete, true);
    assert.strictEqual(a.kudos, 999);
    assert.strictEqual(a.summary, "Harry falls.\n\nDraco catches him.");
    assert.strictEqual(r.results[1].language, "Français");
  });

  await test("recherche FanFiction.net : résultats", async () => {
    const r = await ev((b) => Parsers.Search.parse("ffn", b), page("ffn-search.html"));
    assert.strictEqual(r.next, true);
    const a = r.results[0];
    assert.strictEqual(a.url, "https://www.fanfiction.net/s/12345678/1/The-Long-Road-Home");
    assert.strictEqual(a.title, "The Long Road Home");
    assert.strictEqual(a.author, "Wanderer");
    assert.deepStrictEqual(a.fandoms, ["Harry Potter"]);
    assert.strictEqual(a.rating, "T");
    assert.strictEqual(a.language, "English");
    assert.strictEqual(a.words, 156789);
    assert.strictEqual(a.complete, true);
    assert.strictEqual(a.summary, "Harry finds a way back, but not to the world he left.");
    assert.strictEqual(r.results[1].complete, false);
    assert.strictEqual(r.results[1].rating, "K+");
  });

  await test("recherche Wattpad : résultats", async () => {
    const r = await ev((b) => Parsers.Search.parse("wattpad", b), page("wattpad-search.json"));
    assert.strictEqual(r.next, true);
    assert.strictEqual(r.results[0].url, "https://www.wattpad.com/story/18225403");
    assert.strictEqual(r.results[0].chapters, 42);
  });
  await p.close();

  // ---------------------------------------------------------------- l'app entière
  // Faux pont Android : sert les pages d'exemple, garde les données en mémoire.
  const ao3v2 = page("ao3.html").replace(">12</a>/?", ">14</a>/?");
  const routes = {
    "https://archiveofourown.org/works/search?work_search%5Bquery%5D=drarry": { ok: true, status: 200, body: page("ao3-search.html") },
    "https://archiveofourown.org/works/555/navigate?view_adult=true": { ok: true, status: 200, body: page("ao3-navigate.html") },
    "https://archiveofourown.org/works/555/chapters/2001?view_adult=true": { ok: true, status: 200, body: page("ao3-ch1.html") },
    "https://archiveofourown.org/works/555/chapters/2002?view_adult=true": { ok: true, status: 200, body: page("ao3-ch2.html") },
    "https://www.fanfiction.net/s/12345678/3/": { ok: true, status: 200, body: page("ffn-ch3.html") },
    "https://archiveofourown.org/works/123?view_adult=true": { ok: true, status: 200, body: page("ao3.html") },
    "https://archiveofourown.org/works/9?view_adult=true": { ok: true, status: 200, body: page("ao3-complete.html") },
    "https://www.fanfiction.net/s/12345678/1/": { ok: true, status: 200, body: page("ffn.html") },
    "https://exemple.fr/protege": { ok: false, status: 403, error: "Le site bloque la lecture automatique (protection anti-robot)." },
    "https://exemple.fr/protege#browser": { ok: true, status: 200, body: page("generic.html") },
    "https://www.fanfiction.net/s/1/1/": { ok: false, status: 503, error: "Le site bloque la lecture automatique (protection anti-robot)." },
  };
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const calls = [];
  await ctx.exposeBinding("__route", (src, url) => {
    calls.push(url);
    if (url.startsWith("https://translate.googleapis.com/")) {
      const q = new URL(url).searchParams.get("q");
      const lines = q.split("\n");
      const fr = /Un hiver|Il pleuvait/.test(q);
      const seg = lines.map((l, i) => [(fr ? "" : "[FR] ") + l + (i < lines.length - 1 ? "\n" : ""), l]);
      return { ok: true, status: 200, body: JSON.stringify([seg, null, fr ? "fr" : "en"]) };
    }
    return routes[url] || { ok: false, status: 404, error: "Page introuvable" };
  });
  await ctx.addInitScript(() => {
    const results = {};
    window.__store = "";
    window.__opened = [];
    window.__inbox = "";
    window.__viaBrowser = [];
    window.__cache = {};
    window.__browserOk = { "https://exemple.fr/protege": 1 };
    window.Android = {
      load: () => window.__store,
      save: (j) => { window.__store = j; },
      fetch: (id, url) => window.__route(url).then((r) => { results[id] = JSON.stringify(r); window.__fetched(id); }),
      fetchBrowser: (id, url, ready) => { window.__viaBrowser.push(url); window.__ready = ready; window.Android.fetch(id, url + (window.__browserOk[url] ? "#browser" : "")); },
      take: (id) => results[id],
      cacheGet: (k) => (k in window.__cache ? window.__cache[k] : null),
      cachePut: (k, v) => { window.__cache[k] = v; },
      cacheClear: () => { window.__cache = {}; },
      takeShared: () => { const t = window.__inbox; window.__inbox = ""; return t; },
      ready: () => {},
      open: (u) => window.__opened.push(u),
      exportFile: (n, j) => { window.__exported = j; },
      importFile: () => {},
    };
    window.confirm = () => true;
  });
  const app = await ctx.newPage();
  const errors = [];
  app.on("pageerror", (e) => errors.push(e.message));
  await app.goto("file://" + path.join(WEB, "index.html"));
  const titles = () => app.$$eval("#list .card .t", (els) => els.map((e) => e.textContent));
  const waitIdle = () => app.waitForFunction(() => document.getElementById("progress").hidden && !document.querySelector(".loading"), null, { timeout: 30000 });

  await test("app : liste vide expliquée", async () => {
    assert.match(await app.textContent("#empty"), /Ta liste est vide/);
  });

  await test("app : ajout de plusieurs liens collés, infos lues", async () => {
    await app.click("#fab");
    await app.fill("#addText", "https://archiveofourown.org/works/123/chapters/77\nhttps://www.fanfiction.net/s/12345678/1/\nhttps://www.fanfiction.net/s/1/1/Fic-Bloquee");
    await app.selectOption("#addStatus", "toread");
    await app.fill("#addShelf", "Été 2024");
    await app.click("#addGo");
    await waitIdle();
    const t = await titles();
    assert.deepStrictEqual(t.sort(), ["Fic Bloquee", "Le Dernier Hiver", "The Long Road Home"]);
    const txt = await app.textContent("#list");
    assert.match(txt, /87\s412 mots/);
    assert.match(txt, /12\/\? chap\./);
    assert.match(txt, /infos non lues/);
    assert.match(txt, /Été 2024/);
    assert.strictEqual(await app.evaluate(() => window.PWNED), undefined);
  });

  await test("app : FanFiction.net passe par le navigateur intégré", async () => {
    const via = await app.evaluate(() => window.__viaBrowser);
    assert.deepStrictEqual(via.sort(), ["https://www.fanfiction.net/s/1/1/Fic-Bloquee", "https://www.fanfiction.net/s/12345678/1/"]);
  });

  await test("app : site bloqué -> nouvel essai par le navigateur intégré", async () => {
    await app.evaluate(() => window.FanficsApp.addLinks("https://exemple.fr/protege", "toread", ""));
    await waitIdle();
    assert.ok((await titles()).includes("Rien n'est éternel"));
    await app.evaluate(() => { const f = window.FanficsApp.fics; f.splice(f.findIndex((x) => x.url === "https://exemple.fr/protege"), 1); });
  });

  await test("app : doublon refusé", async () => {
    await app.click("#fab");
    await app.fill("#addText", "https://archiveofourown.org/works/123?view_adult=true");
    await app.click("#addGo");
    assert.match(await app.textContent("#toast"), /Déjà dans ta liste/);
    assert.strictEqual((await titles()).length, 3);
  });

  await test("app : recherche et filtre par fandom", async () => {
    await app.fill("#search", "draco slow");
    assert.deepStrictEqual(await titles(), ["Le Dernier Hiver"]);
    await app.fill("#search", "");
    await app.selectOption("#fFandom", "Harry Potter");
    assert.deepStrictEqual(await titles(), ["The Long Road Home"]);
    await app.selectOption("#fFandom", "");
  });

  await test("app : fiche — statut, note, chapitre lu, notes, ouverture", async () => {
    await app.click("#list .card:has-text('The Long Road Home')");
    await app.click("[data-status=reading]");
    await app.click("[data-star='4']");
    await app.click("[data-act=plus]");
    await app.click("[data-act=plus]");
    await app.fill("#dNotes", "Super début");
    await app.click("[data-act=open]");
    const opened = await app.evaluate(() => window.__opened);
    assert.deepStrictEqual(opened, ["https://www.fanfiction.net/s/12345678/3/"]);
    await app.click("#detail [data-close]");
    await app.waitForTimeout(300); // enregistrement différé
    const f = await app.evaluate(() => JSON.parse(window.__store).fics.find((x) => x.title === "The Long Road Home"));
    assert.strictEqual(f.status, "reading");
    assert.strictEqual(f.stars, 4);
    assert.strictEqual(f.lastRead, 2);
    assert.strictEqual(f.notes, "Super début");
    await app.click("#tabs [data-tab=reading]");
    assert.deepStrictEqual(await titles(), ["The Long Road Home"]);
    await app.click("#tabs [data-tab=all]");
  });

  await test("app : modification à la main d'une fic non lue", async () => {
    await app.click("#list .card:has-text('Fic Bloquee')");
    await app.click("[data-act=edit]");
    await app.fill("#eTitle", "Fic Bloquée");
    await app.fill("#eAuthor", "Quelqu'un");
    await app.fill("#eFandoms", "Naruto, Naruto");
    await app.fill("#eCh", "5");
    await app.click("[data-act=saveEdit]");
    await app.click("#detail [data-close]");
    const txt = await app.textContent("#list .card:has-text('Fic Bloquée')");
    assert.match(txt, /Quelqu'un/);
    assert.match(txt, /5\/\? chap\./);
    assert.doesNotMatch(txt, /infos non lues/);
  });

  await test("app : nouveaux chapitres détectés", async () => {
    routes["https://archiveofourown.org/works/123?view_adult=true"].body = ao3v2;
    await app.click("#btnUpdates");
    await waitIdle();
    await app.waitForFunction(() => document.querySelector("#tabs [data-tab=new]"));
    assert.deepStrictEqual(await titles(), ["Le Dernier Hiver"]);
    assert.match(await app.textContent("#list"), /\+2 chap\./);
    await app.click("#list .card");
    await app.click("[data-act=seen]");
    await app.click("#detail [data-close]");
    assert.strictEqual(await app.$("#tabs [data-tab=new]"), null);
  });

  await test("app : lien partagé depuis une autre app", async () => {
    await app.evaluate(() => { window.__inbox = "One & Done https://archiveofourown.org/works/9"; window.__shared(); });
    await waitIdle();
    assert.ok((await titles()).includes("One & Done"));
  });

  await test("app : retour Android ferme puis réinitialise les filtres", async () => {
    await app.fill("#search", "zzz");
    await app.dispatchEvent("#search", "input");
    await app.click("#fab");
    assert.strictEqual(await app.evaluate(() => window.__back()), true);
    assert.strictEqual(await app.isHidden("#addSheet"), true);
    assert.strictEqual(await app.evaluate(() => window.__back()), true);
    assert.strictEqual(await app.inputValue("#search"), "");
    assert.strictEqual(await app.evaluate(() => window.__back()), false);
  });

  await test("app : sauvegarde puis restauration", async () => {
    await app.click("#btnMenu");
    await app.click("#mExport");
    const backup = await app.evaluate(() => window.__exported);
    assert.strictEqual(JSON.parse(backup).fics.length, 4);
    await app.evaluate(() => { window.__store = ""; });
    await app.reload();
    await app.waitForSelector("#empty:not([hidden])");
    await app.evaluate((b) => { window.__inbox = b; window.__imported(); }, backup);
    assert.strictEqual((await titles()).length, 4);
    await app.waitForTimeout(300);
    const f = await app.evaluate(() => JSON.parse(window.__store).fics.find((x) => x.title === "The Long Road Home"));
    assert.strictEqual(f.stars, 4);
  });

  await test("app : recherche AO3, résumés traduits, ajout", async () => {
    await app.click("#btnSearch");
    await app.fill("#sQuery", "drarry");
    await app.press("#sQuery", "Enter");
    await app.waitForSelector(".sres");
    assert.deepStrictEqual(await app.$$eval(".sres .t", (e) => e.map((x) => x.textContent)), ["Stars Fall", "Hiver"]);
    await app.waitForFunction(() => /\[FR\] Harry falls/.test(document.querySelector(".sres .ssum").textContent));
    // Le résumé déjà en français n'est pas envoyé à la traduction.
    assert.strictEqual(await app.textContent(".sres[data-i='1'] .ssum"), "Un hiver à Poudlard.");
    assert.ok(!calls.some((u) => u.includes("translate") && decodeURIComponent(u).includes("Un hiver")));
    await app.click(".sres[data-i='1'] [data-s=add]");
    assert.match(await app.textContent(".sres[data-i='1']"), /Dans ta liste/);
  });

  await test("app : lecture d'un chapitre traduit depuis la recherche", async () => {
    await app.click(".sres[data-i='0'] [data-s=read]");
    await app.waitForSelector("#reader:not([hidden])");
    await app.waitForFunction(() => /Traduit automatiquement/.test(document.getElementById("rBanner").textContent));
    const txt = await app.textContent("#rBody");
    assert.match(txt, /\[FR\] Chapter 1: Beginnings/);
    assert.match(txt, /\[FR\] Harry looked at the sky\./);
    assert.strictEqual(await app.textContent("#rCh"), "Chapitre 1/2");
    await app.click("#rBanner [data-r=showOrig]");
    assert.match(await app.textContent("#rBody"), /^Chapter 1: Beginnings/);
    assert.doesNotMatch(await app.textContent("#rBody"), /\[FR\]/);
  });

  await test("app : chapitre suivant, progression, chapitre préparé à l'avance", async () => {
    const before = calls.length;
    await app.click("#rBody [data-r=next]");
    await app.waitForFunction(() => /\[FR\] Draco smiled, chapter 2/.test(document.getElementById("rBody").textContent));
    // Le chapitre 2 et sa traduction étaient déjà prêts : aucun nouveau téléchargement.
    assert.deepStrictEqual(calls.slice(before), []);
    assert.match(await app.textContent("#rBody .rend"), /Fin\./);
    const f = await app.evaluate(() => window.FanficsApp.fics.find((x) => x.title === "Stars Fall"));
    assert.strictEqual(f.lastRead, 1);
    assert.strictEqual(f.readCh, 2);
    assert.strictEqual(f.status, "reading");
  });

  await test("app : retour ferme le lecteur, puis la recherche", async () => {
    assert.strictEqual(await app.evaluate(() => window.__back()), true);
    assert.strictEqual(await app.isHidden("#reader"), true);
    assert.strictEqual(await app.isVisible("#searchView"), true);
    assert.strictEqual(await app.evaluate(() => window.__back()), true);
    assert.strictEqual(await app.isHidden("#searchView"), true);
    assert.ok((await titles()).includes("Stars Fall"));
  });

  await test("app : reprise de lecture hors ligne (cache)", async () => {
    const before = calls.length;
    await app.click("#list .card:has-text('Stars Fall')");
    assert.match(await app.textContent("#detail [data-act=read]"), /Reprendre au chap\. 2/);
    await app.click("#detail [data-act=read]");
    await app.waitForFunction(() => /\[FR\] Draco smiled, chapter 2/.test(document.getElementById("rBody").textContent));
    // Seul le résumé de la fiche a été traduit ; le chapitre vient du téléphone.
    assert.deepStrictEqual(calls.slice(before).filter((u) => !u.includes("Harry%20falls")), []);
    await app.evaluate(() => window.__back());
  });

  await test("app : FanFiction.net — reprise au chapitre suivant, par le navigateur intégré", async () => {
    await app.click("#list .card:has-text('The Long Road Home')");
    await app.click("#detail [data-act=read]");
    await app.waitForFunction(() => /\[FR\] Chapter three begins/.test(document.getElementById("rBody").textContent));
    assert.strictEqual(await app.textContent("#rCh"), "Chapitre 3/24");
    assert.strictEqual(await app.evaluate(() => window.__ready), "#storytext");
    assert.match(await app.textContent("#rList option[selected]"), /3\. Return/);
    await app.evaluate(() => window.__back());
  });

  await test("app : résumé de la fiche traduit, bouton original", async () => {
    await app.click("#list .card:has-text('Stars Fall')");
    await app.waitForFunction(() => /\[FR\] Harry falls/.test(document.getElementById("dSummary").textContent));
    await app.click("#trSummaryBtn");
    assert.strictEqual(await app.textContent("#dSummary"), "Harry falls.\n\nDraco catches him.");
    await app.evaluate(() => window.__back());
  });

  await test("app : traduction coupée dans les réglages", async () => {
    await app.click("#btnMenu");
    await app.uncheck("#setAuto");
    await app.click("#menu [data-close]");
    await app.click("#list .card:has-text('Stars Fall')");
    await app.click("#detail [data-act=read]");
    await app.waitForFunction(() => /Draco smiled, chapter 2/.test(document.getElementById("rBody").textContent));
    assert.doesNotMatch(await app.textContent("#rBody"), /\[FR\]/);
    assert.match(await app.textContent("#rBanner"), /Texte original/);
    await app.evaluate(() => window.__back());
    await app.click("#btnMenu");
    await app.check("#setAuto");
    await app.click("#menu [data-close]");
  });

  await app.waitForTimeout(3500); // laisse partir le message
  await app.screenshot({ path: path.join(__dirname, "capture.png") });
  await app.click("#list .card:has-text('Le Dernier Hiver')");
  await app.screenshot({ path: path.join(__dirname, "capture-fiche.png"), fullPage: true });
  await app.evaluate(() => window.__back());
  await app.click("#list .card:has-text('Stars Fall')");
  await app.click("#detail [data-act=read]");
  await app.waitForFunction(() => /\[FR\] Draco smiled/.test(document.getElementById("rBody").textContent));
  await app.screenshot({ path: path.join(__dirname, "capture-lecteur.png") });
  await app.evaluate(() => window.__back());
  await app.click("#btnSearch");
  await app.screenshot({ path: path.join(__dirname, "capture-recherche.png") });
  await test("app : aucune erreur JavaScript", async () => assert.deepStrictEqual(errors, []));

  await browser.close();
  console.log(failures ? `\n${failures} échec(s)` : "\nTout est bon.");
  process.exit(failures ? 1 : 0);
})();
