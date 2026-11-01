// Reconnaît le site d'un lien et lit les infos d'une fanfic dans la page récupérée.
// Aucune dépendance : fonctionne dans la WebView Android comme dans un navigateur.
(function (global) {
  "use strict";

  const SITES = {
    ao3: "AO3",
    ffn: "FanFiction.net",
    wattpad: "Wattpad",
    other: "Autre site",
  };

  // Extrait tous les liens d'un texte libre (un lien par ligne, texte partagé par une app, etc.).
  function extractUrls(text) {
    const found = String(text || "").match(/https?:\/\/[^\s<>"'()\[\]]+/gi) || [];
    const out = [];
    for (let u of found) {
      u = u.replace(/[.,;:!?»]+$/, "");
      const c = canonical(u);
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }

  // Ramène les différentes formes d'un même lien à une seule adresse (sert aussi à repérer les doublons).
  function canonical(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
    let m;
    if (/(^|\.)archiveofourown\.org$|^ao3\.org$/.test(host)) {
      if ((m = u.pathname.match(/\/works\/(\d+)/))) return "https://archiveofourown.org/works/" + m[1];
      if ((m = u.pathname.match(/\/series\/(\d+)/))) return "https://archiveofourown.org/series/" + m[1];
    }
    if (/(^|\.)fanfiction\.net$|(^|\.)fictionpress\.com$/.test(host)) {
      if ((m = u.pathname.match(/\/s\/(\d+)(?:\/\d+)?(?:\/([^/?#]+))?/))) {
        const base = host.includes("fictionpress") ? "https://www.fictionpress.com" : "https://www.fanfiction.net";
        return base + "/s/" + m[1] + "/1/" + (m[2] || "");
      }
    }
    if (/(^|\.)wattpad\.com$/.test(host)) {
      if ((m = u.pathname.match(/\/story\/(\d+)/))) return "https://www.wattpad.com/story/" + m[1];
      if ((m = u.pathname.match(/^\/(\d+)(?:-|$)/))) return "https://www.wattpad.com/" + m[1];
    }
    u.hash = "";
    return u.toString();
  }

  // Identité d'une histoire, quelle que soit la forme du lien (avec ou sans titre, chapitre…).
  function storyKey(url) {
    const c = canonical(url) || url;
    let m;
    if ((m = c.match(/archiveofourown\.org\/(works|series)\/(\d+)/))) return "ao3:" + m[1] + ":" + m[2];
    if ((m = c.match(/(fanfiction\.net|fictionpress\.com)\/s\/(\d+)/))) return m[1] + ":" + m[2];
    if ((m = c.match(/wattpad\.com\/(story\/)?(\d+)/))) return "wattpad:" + (m[1] ? "s" : "p") + m[2];
    return c;
  }

  function siteOf(url) {
    const h = (() => { try { return new URL(url).hostname; } catch (e) { return ""; } })();
    if (/archiveofourown\.org$/.test(h)) return "ao3";
    if (/fanfiction\.net$|fictionpress\.com$/.test(h)) return "ffn";
    if (/wattpad\.com$/.test(h)) return "wattpad";
    return "other";
  }

  // Adresse à télécharger pour obtenir les infos (peut différer du lien affiché).
  function fetchUrl(url) {
    const site = siteOf(url);
    let m;
    if (site === "ao3" && /\/works\/\d+$/.test(url)) return url + "?view_adult=true";
    if (site === "wattpad" && (m = url.match(/\/story\/(\d+)/)))
      return "https://www.wattpad.com/api/v3/stories/" + m[1] +
        "?fields=id,title,user(name),description,tags,numParts,completed,mature,language(name),url,lastPublishedPart(createDate),createDate,readCount,voteCount";
    return url;
  }

  // Ce qu'on peut deviner sans rien télécharger.
  function fromUrl(url) {
    const site = siteOf(url);
    let title = "";
    let m;
    if (site === "ffn") title = (m = url.match(/\/s\/\d+\/\d+\/([^/?#]+)/)) ? slug(m[1]) : "FanFiction.net n° " + (url.match(/\/s\/(\d+)/) || [, ""])[1];
    else if (site === "wattpad" && (m = url.match(/\/\d+-([^/?#]+)/))) title = slug(m[1]);
    else if (site === "ao3") title = "AO3 n° " + (url.match(/(\d+)$/) || [, ""])[1];
    else {
      try {
        const u = new URL(url);
        const last = u.pathname.split("/").filter(Boolean).pop();
        title = last ? slug(last.replace(/\.\w+$/, "")) : u.hostname;
      } catch (e) { title = url; }
    }
    return { site, title };
  }

  function slug(s) {
    try { s = decodeURIComponent(s); } catch (e) { /* garde tel quel */ }
    s = s.replace(/[-_+]+/g, " ").replace(/^\d+\s+/, "").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Lien du profil de l'auteur (premier auteur s'il y en a plusieurs), en adresse complète.
  const hrefOf = (root, sel, base) => {
    const a = root && root.querySelector(sel);
    if (!a || !a.getAttribute("href")) return "";
    try { return new URL(a.getAttribute("href"), base).toString(); } catch (e) { return ""; }
  };
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const num = (s) => {
    const d = String(s || "").replace(/[^\d]/g, "");
    return d ? parseInt(d, 10) : null;
  };
  const texts = (root, sel) => Array.from(root.querySelectorAll(sel)).map((e) => clean(e.textContent)).filter(Boolean);
  const text = (root, sel) => { const e = root.querySelector(sel); return e ? clean(e.textContent) : ""; };

  // Texte d'un résumé en gardant les paragraphes.
  function paragraphs(el) {
    if (!el) return "";
    const ps = el.querySelectorAll("p");
    if (ps.length) return Array.from(ps).map((p) => clean(p.textContent)).filter(Boolean).join("\n\n");
    return clean(el.textContent);
  }

  // "3/10" -> {chapters:3, total:10} ; "3/?" -> {chapters:3, total:null}
  function chapterPair(s) {
    const m = String(s || "").replace(/\s/g, "").match(/^(\d[\d,.]*)\/(\d[\d,.]*|\?)$/);
    if (!m) return { chapters: num(s), total: null };
    return { chapters: num(m[1]), total: m[2] === "?" ? null : num(m[2]) };
  }

  function parseAo3(doc) {
    const meta = doc.querySelector("dl.work.meta") || doc;
    const preface = doc.querySelector("#workskin .preface") || doc;
    const title = text(preface, "h2.title");
    if (!title) {
      if (/registered users|log in|Log In/i.test(doc.body ? doc.body.textContent : ""))
        throw new Error("Fanfic réservée aux membres AO3 : ajoute les infos à la main.");
      throw new Error("Page AO3 non reconnue.");
    }
    const ch = chapterPair(text(meta, "dd.chapters"));
    const completedDate = text(meta, "dt.status") && /complet/i.test(text(meta, "dt.status")) ? text(meta, "dd.status") : "";
    const updatedDate = text(meta, "dt.status") && !/complet/i.test(text(meta, "dt.status")) ? text(meta, "dd.status") : "";
    const series = Array.from(meta.querySelectorAll("dd.series .position")).map((e) => clean(e.textContent));
    return {
      title,
      author: texts(preface, "a[rel=author]").join(", ") || (/anonymous/i.test(text(preface, ".byline")) ? "Anonyme" : ""),
      authorUrl: hrefOf(preface, "a[rel=author]", "https://archiveofourown.org"),
      fandoms: texts(meta, "dd.fandom a.tag"),
      relationships: texts(meta, "dd.relationship a.tag"),
      characters: texts(meta, "dd.character a.tag"),
      tags: texts(meta, "dd.freeform a.tag"),
      warnings: texts(meta, "dd.warning a.tag"),
      rating: texts(meta, "dd.rating a.tag")[0] || "",
      language: text(meta, "dd.language"),
      words: num(text(meta, "dd.words")),
      chapters: ch.chapters,
      chaptersTotal: ch.total,
      complete: ch.total != null && ch.chapters === ch.total,
      published: text(meta, "dd.published"),
      updated: completedDate || updatedDate || text(meta, "dd.published"),
      kudos: num(text(meta, "dd.kudos")),
      series: series.join(" · "),
      summary: paragraphs(preface.querySelector(".summary blockquote.userstuff")),
    };
  }

  function parseFfn(doc) {
    const top = doc.querySelector("#profile_top");
    if (!top) {
      const page = clean(doc.title) || clean(doc.body ? doc.body.textContent : "").slice(0, 80);
      if (/just a moment|un instant|verify you are human|cf-chl|challenge-platform/i.test(doc.documentElement.innerHTML))
        throw new Error("FanFiction.net bloque la lecture automatique (protection anti-robot). Page reçue : « " + page + " »");
      if (/story not found|unable to locate story/i.test(doc.body ? doc.body.textContent : ""))
        throw new Error("Histoire introuvable sur FanFiction.net (supprimée ou lien erroné).");
      throw new Error("Page FanFiction.net non reconnue. Page reçue : « " + page + " »");
    }
    const stats = text(top, "span.xgray");
    const field = (name) => { const m = stats.match(new RegExp(name + ":\\s*([^-]+?)\\s*(?:-|$)")); return m ? m[1].trim() : ""; };
    const parts = stats.split(/\s+-\s+/);
    const rated = (stats.match(/Rated:\s*(?:Fiction\s+)?([A-Z+]+)/) || [, ""])[1];
    const chapters = num(field("Chapters")) || 1;
    const complete = /Status:\s*Complete/i.test(stats);
    const links = doc.querySelectorAll("#pre_story_links a");
    const fandom = links.length ? clean(links[links.length - 1].textContent) : "";
    // Après la langue viennent les genres (pas un champ « Nom: »), puis souvent les personnages.
    const lang = parts[1] || "";
    const extra = parts.slice(2).filter((p) => !/:\s/.test(p));
    const genres = extra[0] && /^[A-Z][a-z-]+(\/[A-Z][a-z-]+)*$/.test(extra[0])
      ? extra.shift().replace("Hurt/Comfort", "Hurt-Comfort").split("/").map((g) => g.replace("Hurt-Comfort", "Hurt/Comfort"))
      : [];
    const characters = extra.join(", ").replace(/[\[\]]/g, ",").split(",").map(clean).filter(Boolean);
    const pub = top.querySelectorAll("span[data-xutime]");
    const date = (el) => el ? new Date(parseInt(el.getAttribute("data-xutime"), 10) * 1000).toISOString().slice(0, 10) : "";
    return {
      title: text(top, "b.xcontrast_txt"),
      author: text(top, "a.xcontrast_txt[href^='/u/']"),
      authorUrl: hrefOf(top, "a[href^='/u/']", "https://www.fanfiction.net"),
      fandoms: fandom ? [fandom] : [],
      relationships: [],
      characters,
      tags: genres,
      warnings: [],
      rating: rated,
      language: lang,
      words: num(field("Words")),
      chapters,
      chaptersTotal: complete ? chapters : null,
      complete,
      published: date(pub[pub.length - 1]),
      updated: date(pub[0]),
      kudos: num(field("Favs")),
      series: "",
      summary: text(top, "div.xcontrast_txt"),
    };
  }

  function parseWattpadJson(json) {
    const d = typeof json === "string" ? JSON.parse(json) : json;
    if (!d || !d.title) throw new Error("Histoire Wattpad introuvable.");
    return {
      title: clean(d.title),
      author: d.user ? clean(d.user.name) : "",
      authorUrl: d.user && d.user.name ? "https://www.wattpad.com/user/" + encodeURIComponent(d.user.name) : "",
      fandoms: [],
      relationships: [],
      characters: [],
      tags: (d.tags || []).map(clean),
      warnings: [],
      rating: d.mature ? "Mature" : "", mature: !!d.mature,
      language: d.language ? d.language.name : "",
      words: null,
      chapters: d.numParts || null,
      chaptersTotal: d.completed ? d.numParts : null,
      complete: !!d.completed,
      published: (d.createDate || "").slice(0, 10),
      updated: ((d.lastPublishedPart && d.lastPublishedPart.createDate) || "").slice(0, 10),
      kudos: d.voteCount || null,
      series: "",
      summary: String(d.description || "").trim(),
    };
  }

  // Tout autre site : on se contente des balises de partage (og:title…) et du titre de la page.
  function parseGeneric(doc) {
    const meta = (k) => {
      const e = doc.querySelector(`meta[property="${k}"],meta[name="${k}"]`);
      return e ? clean(e.getAttribute("content")) : "";
    };
    const title = meta("og:title") || meta("twitter:title") || text(doc, "title") || text(doc, "h1");
    if (!title) throw new Error("Aucun titre trouvé sur la page.");
    return {
      title,
      author: meta("author") || meta("article:author") || meta("book:author"),
      fandoms: [],
      relationships: [],
      characters: [],
      tags: meta("keywords") ? meta("keywords").split(",").map(clean).filter(Boolean).slice(0, 15) : [],
      warnings: [],
      rating: "",
      language: doc.documentElement.getAttribute("lang") || "",
      words: null,
      chapters: null,
      chaptersTotal: null,
      complete: false,
      published: "",
      updated: "",
      kudos: null,
      series: "",
      summary: meta("og:description") || meta("description"),
    };
  }

  // body : texte téléchargé depuis fetchUrl(url). Renvoie les infos, ou lève une erreur lisible.
  function parse(url, body) {
    const site = siteOf(url);
    if (site === "wattpad" && /\/story\/\d+/.test(url)) return parseWattpadJson(body);
    const doc = new DOMParser().parseFromString(body, "text/html");
    let info;
    if (site === "ao3") info = parseAo3(doc);
    else if (site === "ffn") info = parseFfn(doc);
    else info = parseGeneric(doc);
    if (site === "wattpad") info.title = info.title.replace(/\s*-\s*Wattpad\s*$/i, "");
    return info;
  }


  // ================================================================ chapitres (lecteur)

  // Texte d'un élément, découpé en paragraphes (sauts de ligne et blocs respectés).
  function paragraphsOf(el) {
    if (!el) return [];
    const c = el.cloneNode(true);
    c.querySelectorAll("script,style,noscript,.landmark,form,button,select,iframe,img").forEach((e) => e.remove());
    c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    c.querySelectorAll("hr").forEach((h) => h.replaceWith("\n* * *\n"));
    c.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,blockquote,center,pre,tr,section,article").forEach((b) => { b.prepend("\n"); b.append("\n"); });
    return c.textContent.split("\n").map((t) => t.replace(/[ \t ​]+/g, " ").trim()).filter(Boolean);
  }

  const abs = (href, base) => { try { return new URL(href, base).toString(); } catch (e) { return href; } };
  const html = (body) => new DOMParser().parseFromString(body, "text/html");
  const wattpadPart = (id) => "https://www.wattpad.com/apiv2/storytext?id=" + id;

  const Chapters = {
    // Adresse de la liste des chapitres, ou null si la liste vient du chapitre lui-même / n'existe pas.
    listUrl(url) {
      const site = siteOf(url);
      let m;
      if (site === "ao3" && (m = url.match(/\/works\/(\d+)$/))) return "https://archiveofourown.org/works/" + m[1] + "/navigate?view_adult=true";
      if (site === "wattpad" && (m = url.match(/\/story\/(\d+)/))) return "https://www.wattpad.com/api/v3/stories/" + m[1] + "?fields=parts(id,title)";
      return null;
    },

    // Liste connue sans rien télécharger (FanFiction.net : complétée en lisant le chapitre).
    initialList(url, title, count) {
      const site = siteOf(url);
      let m;
      if (site === "ffn") {
        const n = Math.max(1, count || 1);
        return Array.from({ length: n }, (_, i) => ({ title: "Chapitre " + (i + 1), url: this.ffnChapter(url, i + 1) }));
      }
      if (site === "wattpad" && (m = url.match(/wattpad\.com\/(\d+)$/))) return [{ title: title || "Partie", url: wattpadPart(m[1]) }];
      if (this.listUrl(url)) return null;
      return [{ title: title || "Texte", url }];
    },

    ffnChapter(url, n) {
      return url.replace(/\/s\/(\d+)\/\d+\/.*$/, "/s/$1/" + n + "/");
    },

    parseList(url, body) {
      const site = siteOf(url);
      if (site === "wattpad") {
        const d = JSON.parse(body);
        const parts = (d && d.parts) || [];
        if (!parts.length) throw new Error("Aucune partie trouvée sur Wattpad.");
        return parts.map((p) => ({ title: clean(p.title), url: wattpadPart(p.id) }));
      }
      const doc = html(body);
      const list = Array.from(doc.querySelectorAll("ol.chapter.index a, ol.index a, #main ol a"))
        .map((a) => a.getAttribute("href") || "")
        .filter((h, i, all) => /\/works\/\d+\/chapters\/\d+/.test(h) && all.indexOf(h) === i);
      if (!list.length) {
        if (/registered users|log in/i.test(doc.body ? doc.body.textContent : ""))
          throw new Error("Fanfic réservée aux membres AO3 : lecture impossible dans l'app.");
        throw new Error("Liste des chapitres introuvable.");
      }
      const titles = new Map(Array.from(doc.querySelectorAll("ol a")).map((a) => [a.getAttribute("href"), clean(a.textContent)]));
      return list.map((h) => ({ title: titles.get(h) || "", url: abs(h.split("?")[0], "https://archiveofourown.org") + "?view_adult=true" }));
    },

    // Sélecteur qui prouve que la page du chapitre est arrivée (navigateur intégré).
    readySelector(url) {
      return siteOf(url) === "ffn" ? "#storytext" : "";
    },

    // Renvoie { title, paragraphs, list } ; list seulement si la page donne la liste des chapitres.
    parseChapter(url, body) {
      const site = siteOf(url);
      if (site === "wattpad") {
        const p = paragraphsOf(html(body).body);
        if (!p.length) throw new Error("Partie Wattpad vide ou inaccessible.");
        return { title: "", paragraphs: p, list: null };
      }
      const doc = html(body);
      if (site === "ao3") {
        const root = doc.querySelector("#chapters");
        if (!root) {
          if (/registered users|log in/i.test(doc.body ? doc.body.textContent : ""))
            throw new Error("Fanfic réservée aux membres AO3 : lecture impossible dans l'app.");
          throw new Error("Texte du chapitre introuvable.");
        }
        const text = root.querySelector("div.userstuff[role=article]") || root.querySelector("div.userstuff") || root;
        return { title: text_(root, ".chapter.preface h3.title, h3.title"), paragraphs: paragraphsOf(text), list: null };
      }
      if (site === "ffn") {
        const text = doc.querySelector("#storytext");
        if (!text) throw new Error("Texte du chapitre introuvable sur FanFiction.net.");
        const opts = Array.from((doc.querySelector("#chap_select") || doc).querySelectorAll("#chap_select option"));
        const list = opts.length ? opts.map((o) => ({ title: clean(o.textContent).replace(/^\d+\.\s*/, ""), url: this.ffnChapter(url, +o.value) })) : null;
        const cur = opts.find((o) => o.selected);
        return { title: cur ? clean(cur.textContent).replace(/^\d+\.\s*/, "") : "", paragraphs: paragraphsOf(text), list };
      }
      // Autre site : le bloc qui contient le plus de texte en paragraphes.
      let best = null, bestScore = 0;
      for (const el of doc.querySelectorAll("article, main, section, div, td")) {
        let score = 0;
        for (const ch of el.children) if (ch.tagName === "P" || ch.tagName === "BR") score += ch.textContent.length + (ch.tagName === "BR" ? 40 : 0);
        if (score > bestScore) { best = el; bestScore = score; }
      }
      const paras = paragraphsOf(bestScore > 300 ? best : doc.body);
      if (!paras.length) throw new Error("Aucun texte trouvé sur la page.");
      return { title: "", paragraphs: paras, list: null };
    },
  };
  function text_(root, sel) { const e = root.querySelector(sel); return e ? clean(e.textContent) : ""; }


  const ao3Next = (doc) => !!doc.querySelector("ol.pagination li.next a, a[rel=next]");

  // Une fanfic dans une liste AO3 (recherche, marque-pages, œuvres d'un auteur).
  function ao3Blurb(li) {
    const link = li.querySelector("h4.heading a[href*='/works/']");
    if (!link) return null; // série, lien externe ou œuvre supprimée
    const ch = chapterPair(text(li, "dd.chapters"));
    return {
      site: "ao3", url: canonical(abs(link.getAttribute("href"), "https://archiveofourown.org")),
      title: clean(link.textContent),
      author: texts(li, "h4.heading a[rel=author]").join(", ") || "Anonyme",
      authorUrl: hrefOf(li, "h4.heading a[rel=author]", "https://archiveofourown.org"),
      fandoms: texts(li, "h5.fandoms a.tag"),
      relationships: texts(li, "li.relationships a.tag"),
      characters: texts(li, "li.characters a.tag"),
      tags: texts(li, "li.freeforms a.tag"),
      warnings: texts(li, "li.warnings a.tag"),
      rating: text(li, ".required-tags .rating .text") || (li.querySelector(".required-tags .rating") || { title: "" }).title || "",
      language: text(li, "dd.language"),
      words: num(text(li, "dd.words")),
      chapters: ch.chapters, chaptersTotal: ch.total, complete: ch.total != null && ch.chapters === ch.total,
      published: "", updated: text(li, "p.datetime"),
      kudos: num(text(li, "dd.kudos")), series: "",
      summary: paragraphs(li.querySelector("blockquote.summary")),
    };
  }

  // Une fanfic dans une liste FanFiction.net (recherche, favoris ou histoires d'un profil).
  function ffnZ(z, defaultAuthor, defaultAuthorUrl) {
    const link = z.querySelector("a.stitle");
    if (!link) return null;
    const statsEl = z.querySelector(".z-padtop2, .xgray");
    const stats = statsEl ? clean(statsEl.textContent) : "";
    const ind = z.querySelector(".z-indent");
    let summary = ind ? clean(ind.textContent) : "";
    if (stats && summary.endsWith(stats)) summary = summary.slice(0, -stats.length).trim();
    const field = (n) => { const m = stats.match(new RegExp(n + ":\\s*([^-]+?)\\s*(?:-|$)")); return m ? m[1].trim() : ""; };
    const d = z.dataset || {};
    const chapters = num(field("Chapters")) || num(d.chapters) || 1;
    const complete = /(^|-)\s*Complete\s*($|-)/.test(stats) || d.statusid === "2";
    const fandom = d.category || (stats.split(/\s+-\s+Rated:/)[0] || "").trim();
    const parts = stats.split(/\s+-\s+/);
    const ri = parts.findIndex((p) => /^Rated:/.test(p));
    return {
      site: "ffn", url: canonical(abs(link.getAttribute("href"), "https://www.fanfiction.net")),
      title: clean(link.textContent) || clean(d.title),
      author: text(z, "a[href^='/u/']") || defaultAuthor || "",
      authorUrl: hrefOf(z, "a[href^='/u/']", "https://www.fanfiction.net") || defaultAuthorUrl || "",
      fandoms: fandom && !/^Rated:/.test(fandom) ? [fandom] : [],
      relationships: [], characters: [], tags: [], warnings: [],
      rating: (stats.match(/Rated:\s*(?:Fiction\s+)?([A-Z+]+)/) || [, ""])[1],
      language: ri >= 0 ? parts[ri + 1] || "" : "",
      words: num(field("Words")) || num(d.wordcount),
      chapters, chaptersTotal: complete ? chapters : null, complete,
      published: "", updated: "", kudos: num(field("Favs")), series: "",
      summary,
    };
  }

  // ================================================================ comptes et auteurs

  // Lien de profil (compte d'un lecteur ou page d'un auteur) -> {site, id, name, url}, sinon null.
  function profileOf(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
    let m;
    if (/fanfiction\.net$/.test(host) && (m = u.pathname.match(/^\/u\/(\d+)(?:\/([^/?#]+))?/)))
      return { site: "ffn", id: m[1], name: m[2] ? slug(m[2]) : "", url: "https://www.fanfiction.net/u/" + m[1] + "/" + (m[2] || "") };
    if (/archiveofourown\.org$/.test(host) && (m = u.pathname.match(/^\/users\/([^/?#]+)/)))
      return { site: "ao3", id: m[1], name: decodeURIComponent(m[1]), url: "https://archiveofourown.org/users/" + m[1] };
    if (/wattpad\.com$/.test(host) && (m = u.pathname.match(/^\/user\/([^/?#]+)/)))
      return { site: "wattpad", id: m[1], name: decodeURIComponent(m[1]), url: "https://www.wattpad.com/user/" + m[1] };
    return null;
  }

  // Profil de l'auteur d'une fanfic : depuis son lien, sinon deviné d'après son nom (AO3, Wattpad).
  // FanFiction.net : impossible sans le numéro du profil -> null (il faut relire la fanfic).
  function authorProfile(f) {
    const p = f.authorUrl && profileOf(f.authorUrl);
    if (p) return Object.assign(p, { name: (f.author || "").split(", ")[0] || p.name });
    const name = (f.author || "").split(", ")[0].trim();
    if (!name || name === "Anonyme") return null;
    if (f.site === "ao3") return Object.assign(profileOf("https://archiveofourown.org/users/" + encodeURIComponent(name)), { name });
    if (f.site === "wattpad") return Object.assign(profileOf("https://www.wattpad.com/user/" + encodeURIComponent(name)), { name });
    return null;
  }

  const WP = "https://www.wattpad.com";
  const WP_STORY = "id,title,user(name),description,numParts,completed,tags,voteCount,mature,language(name)";
  const wpStories = (list) => (list || []).filter((x) => x && x.id).map((x) => Object.assign(parseWattpadJson(x), { url: "https://www.wattpad.com/story/" + x.id, site: "wattpad" }));

  const Profiles = {
    // Pages à lire pour importer les favoris d'un compte : [{kind, url}] (kind : "stories" ou "authors").
    // AO3 : les marque-pages (publics) ; les auteurs suivis sont privés sur AO3.
    favoritePages(p, page) {
      page = page || 1;
      if (p.site === "ffn") return page === 1 ? [{ kind: "both", url: p.url }] : [];
      if (p.site === "ao3") return [{ kind: "stories", url: "https://archiveofourown.org/users/" + p.id + "/bookmarks" + (page > 1 ? "?page=" + page : "") }];
      if (p.site === "wattpad") {
        if (page > 1) return [];
        // L'API de Wattpad n'est pas documentée : plusieurs adresses possibles, essayées dans l'ordre (alts).
        const lists = "/lists?limit=50&fields=lists(name,stories(" + WP_STORY + "))";
        const follow = "/following?limit=200&fields=users(username,name)";
        return [
          { kind: "stories", url: WP + "/api/v3/users/" + p.id + lists, alts: [WP + "/v4/users/" + p.id + lists] },
          { kind: "authors", url: WP + "/api/v3/users/" + p.id + follow, alts: [WP + "/v4/users/" + p.id + follow] },
        ];
      }
      return [];
    },

    readySelector(site) {
      return site === "ffn" ? "#content_wrapper_inner" : "";
    },

    // -> { owner, stories: [infos], authors: [{site, id, name, url}], next }
    parseFavorites(p, kind, body) {
      const out = { owner: "", stories: [], authors: [], next: false };
      if (p.site === "wattpad") {
        const d = JSON.parse(body);
        if (kind === "authors") out.authors = (d.users || []).map((x) => x && x.username && profileOf("https://www.wattpad.com/user/" + encodeURIComponent(x.username))).filter(Boolean);
        else for (const l of d.lists || []) out.stories.push(...wpStories(l.stories));
        return out;
      }
      const doc = html(body);
      if (p.site === "ao3") {
        if (!doc.querySelector("li.bookmark, ol.bookmark, #main") ) throw new Error("Page de marque-pages AO3 non reconnue.");
        out.stories = Array.from(doc.querySelectorAll("li.bookmark.blurb, li.blurb")).map(ao3Blurb).filter(Boolean);
        out.next = ao3Next(doc);
        return out;
      }
      // FanFiction.net : une seule page de profil contient tout.
      if (!doc.querySelector("#content_wrapper_inner")) throw new Error("Profil FanFiction.net non reconnu.");
      out.owner = clean((doc.title || "").split("|")[0]);
      let favs = doc.querySelectorAll("div.z-list.favstories");
      if (!favs.length) favs = doc.querySelectorAll("#fs div.z-list, #fs_inside div.z-list");
      out.stories = Array.from(favs).map((z) => ffnZ(z)).filter(Boolean);
      const seen = new Set([p.id]);
      for (const a of doc.querySelectorAll("#fa a[href*='/u/']")) {
        const pr = profileOf(abs(a.getAttribute("href"), "https://www.fanfiction.net"));
        if (!pr || seen.has(pr.id)) continue;
        seen.add(pr.id);
        pr.name = clean(a.textContent) || pr.name;
        out.authors.push(pr);
      }
      return out;
    },

    // Trouver un compte à partir d'un simple pseudo : adresse à télécharger pour ce site.
    lookupUrl(site, name) {
      const e = encodeURIComponent(name.trim());
      if (site === "ao3") return "https://archiveofourown.org/users/" + e + "/profile";
      if (site === "wattpad") return "https://www.wattpad.com/api/v3/users/" + e + "?fields=username,name,description,numStoriesPublished,numFollowers,numFollowing,numLists,createDate";
      if (site === "ffn") return "https://www.fanfiction.net/search/?keywords=" + e.replace(/%20/g, "+") + "&ready=1&type=writer";
      return null;
    },

    // -> profil {site, id, name, url, bio, joined, stats} ou null si aucun compte de ce nom.
    parseLookup(site, name, body) {
      const want = name.trim().toLowerCase();
      if (site === "wattpad") {
        const d = JSON.parse(body);
        if (!d || !d.username) return null;
        const p = profileOf("https://www.wattpad.com/user/" + encodeURIComponent(d.username));
        return Object.assign(p, {
          name: d.username, bio: String(d.description || "").trim(), joined: (d.createDate || "").slice(0, 10),
          stats: [[d.numStoriesPublished, "histoires"], [d.numLists, "listes"], [d.numFollowers, "abonnés"]].filter((x) => x[0] != null),
        });
      }
      const doc = html(body);
      if (site === "ao3") {
        const h = doc.querySelector("#main h2.heading, #main .primary h2, h2.heading");
        // Pseudo inconnu : AO3 renvoie vers sa recherche de membres, dont le titre n'est pas le pseudo.
        if (!h || clean(h.textContent).toLowerCase() !== want) return null;
        const link = h.querySelector("a[href^='/users/']");
        const id = link ? (link.getAttribute("href").match(/^\/users\/([^/?#]+)/) || [, name])[1] : encodeURIComponent(name);
        const p = profileOf("https://archiveofourown.org/users/" + id);
        const joined = Array.from(doc.querySelectorAll("dl.meta dt")).find((dt) => /joined|inscri/i.test(dt.textContent));
        return Object.assign(p, {
          name: clean(h.textContent) || p.name,
          bio: paragraphs(doc.querySelector(".bio blockquote.userstuff, blockquote.userstuff")),
          joined: joined && joined.nextElementSibling ? clean(joined.nextElementSibling.textContent) : "",
          stats: [],
        });
      }
      if (site === "ffn") {
        if (/must be logged in to access|login required/i.test(doc.body ? doc.body.textContent.slice(0, 2000) : "")) {
          const e = new Error("FanFiction.net demande d'être connecté(e) pour chercher un pseudo.");
          e.login = true;
          throw e;
        }
        const links = Array.from(doc.querySelectorAll("#content_wrapper_inner a[href^='/u/'], a[href^='/u/']"));
        const exact = links.find((a) => clean(a.textContent).toLowerCase() === want);
        if (!exact) return null; // FanFiction.net renvoie des noms proches : on ne garde que le pseudo exact
        const p = profileOf(abs(exact.getAttribute("href"), "https://www.fanfiction.net"));
        return Object.assign(p, { name: clean(exact.textContent), bio: "", joined: "", stats: [] });
      }
      return null;
    },

    // Histoires écrites par un auteur : adresse de la page n.
    worksUrl(p, page) {
      return this.worksUrls(p, page)[0] || null;
    },

    // Adresses possibles, dans l'ordre d'essai (Wattpad en a plusieurs selon les versions de son API).
    worksUrls(p, page) {
      page = page || 1;
      if (p.site === "ffn") return page === 1 ? [p.url] : [];
      if (p.site === "ao3") return ["https://archiveofourown.org/users/" + p.id + "/works" + (page > 1 ? "?page=" + page : "")];
      if (p.site === "wattpad") {
        const q = "?offset=" + (page - 1) * 50 + "&limit=50&fields=stories(" + WP_STORY + "),total,nextUrl";
        return [
          WP + "/v4/users/" + p.id + "/stories/published" + q,
          WP + "/api/v3/users/" + p.id + "/stories" + q,
          WP + "/api/v3/users/" + p.id + "/stories/published" + q,
        ];
      }
      return [];
    },

    // Réponse de Wattpad qui est en fait une erreur (certaines adresses répondent 200 avec un message d'erreur).
    wattpadError(body) {
      try { const d = JSON.parse(body); return !!(d && (d.error_type || d.error_code || d.error)); } catch (e) { return true; }
    },

    parseWorks(p, body) {
      if (p.site === "wattpad") {
        const d = JSON.parse(body);
        const results = wpStories(d.stories);
        return { results, next: !!d.nextUrl || (d.total != null && results.length >= 50) };
      }
      const doc = html(body);
      if (p.site === "ao3") return { results: Array.from(doc.querySelectorAll("li.work.blurb, li.blurb")).map(ao3Blurb).filter(Boolean), next: ao3Next(doc) };
      const owner = clean((doc.title || "").split("|")[0]) || p.name;
      let mine = doc.querySelectorAll("div.z-list.mystories");
      if (!mine.length) mine = doc.querySelectorAll("#st div.z-list, #st_inside div.z-list");
      return { results: Array.from(mine).map((z) => ffnZ(z, owner, p.url)).filter(Boolean), next: false };
    },
  };

  // ================================================================ recherche

  // ---- Recherche précise : opérateurs, filtrage strict et tri par pertinence (côté app).
  const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // "phrase exacte", -exclu, #tag, @auteur, mots (tous requis).
  function parseQuery(q) {
    const o = { phrases: [], exclude: [], tags: [], authors: [], words: [] };
    String(q || "").replace(/"([^"]+)"|(\S+)/g, (_, ph, w) => {
      if (ph) o.phrases.push(norm(ph));
      else if (w[0] === "-" && w.length > 1) o.exclude.push(norm(w.slice(1)));
      else if (w[0] === "#" && w.length > 1) o.tags.push(norm(w.slice(1)));
      else if (w[0] === "@" && w.length > 1) o.authors.push(norm(w.slice(1)));
      else o.words.push(norm(w));
      return "";
    });
    o.api = [...o.words, ...o.phrases, ...o.tags].join(" ").trim() || o.authors.join(" ");
    return o;
  }

  // Garde les résultats qui respectent tout, triés par pertinence. f : {language, complete, mature}
  function refine(results, q, f) {
    const o = parseQuery(q);
    f = f || {};
    const out = [];
    for (const r of results) {
      const title = norm(r.title), tags = (r.tags || []).map(norm), author = norm(r.author), desc = norm(r.summary);
      const all = [title, tags.join(" "), author, desc].join(" \n ");
      if (f.complete && !r.complete) continue;
      if (f.noMature && r.mature) continue;
      if (f.language && !norm(r.language).startsWith(norm(f.language).slice(0, 4))) continue;
      if (o.exclude.some((w) => all.includes(w))) continue;
      if (!o.phrases.every((ph) => all.includes(ph))) continue;
      if (!o.tags.every((t) => tags.some((x) => x === t || x.replace(/[\s_-]/g, "") === t.replace(/[\s_-]/g, "")))) continue;
      if (!o.authors.every((a) => author.includes(a))) continue;
      if (!o.words.every((w) => all.includes(w))) continue;
      const qn = [...o.phrases, ...o.words].join(" ");
      let score = title === qn ? 100 : qn && title.includes(qn) ? 50 : 0;
      const tw = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      let hit = 0;
      for (const w of [...o.words, ...o.phrases]) {
        const whole = tw.includes(w); // mot entier : « glace » ne vaut pas « glaces »
        if (whole) hit++;
        score += (title.includes(w) ? 10 : 0) + (whole ? 5 : 0) + (tags.some((t) => t.includes(w)) ? 6 : 0) + (author.includes(w) ? 4 : 0) + (desc.includes(w) ? 2 : 0);
      }
      if (tw.length) score += 5 * hit / tw.length; // titre court et précis devant
      score += o.tags.length * 6 + Math.log10((r.kudos || 0) + 1);
      out.push([score, r]);
    }
    return out.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  const Search = {
    parseQuery, refine,
    sites: ["ao3", "ffn", "wattpad"],

    url(site, q, o, page) {
      o = o || {};
      page = page || 1;
      const e = encodeURIComponent;
      if (site === "ao3") {
        let u = "https://archiveofourown.org/works/search?work_search%5Bquery%5D=" + e(q || "");
        if (o.language) u += "&work_search%5Blanguage_id%5D=" + e(o.language);
        if (o.complete) u += "&work_search%5Bcomplete%5D=T";
        if (o.sort) u += "&work_search%5Bsort_column%5D=" + e(o.sort) + "&work_search%5Bsort_direction%5D=desc";
        return u + (page > 1 ? "&page=" + page : "");
      }
      if (site === "ffn") return "https://www.fanfiction.net/search/?keywords=" + e(q || "").replace(/%20/g, "+") + "&ready=1&type=story" + (page > 1 ? "&ppage=" + page : "");
      if (site === "wattpad")
        return "https://www.wattpad.com/api/v3/stories?query=" + e(parseQuery(q).api) + "&limit=50&offset=" + (page - 1) * 50 +
          "&fields=stories(id,title,user(name),description,numParts,completed,tags,voteCount,mature,language(name)),nextUrl";
      throw new Error("Site inconnu");
    },

    readySelector(site) {
      return site === "ffn" ? ".z-list, #content_wrapper_inner" : "";
    },

    parse(site, body) {
      if (site === "wattpad") {
        const d = JSON.parse(body);
        return {
          next: !!d.nextUrl,
          results: (d.stories || []).map((s) => Object.assign(parseWattpadJson(s), { url: "https://www.wattpad.com/story/" + s.id, site })),
        };
      }
      const doc = html(body);
      if (site === "ao3") {
        const results = Array.from(doc.querySelectorAll("li.work.blurb, li.bookmark.blurb, li.blurb")).map(ao3Blurb).filter(Boolean);
        return { results, next: ao3Next(doc) };
      }
      if (site === "ffn") {
        const results = Array.from(doc.querySelectorAll("div.z-list")).map((z) => ffnZ(z)).filter(Boolean);
        const next = Array.from(doc.querySelectorAll("center a, #content_wrapper_inner a")).some((a) => /next/i.test(a.textContent));
        return { results, next };
      }
      throw new Error("Site inconnu");
    },
  };

  global.Parsers = { SITES, extractUrls, canonical, siteOf, fetchUrl, fromUrl, parse, chapterPair, paragraphsOf, Chapters, Search, Profiles, profileOf, storyKey, authorProfile };
})(typeof window !== "undefined" ? window : globalThis);
