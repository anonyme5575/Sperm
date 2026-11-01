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
      fandoms: [],
      relationships: [],
      characters: [],
      tags: (d.tags || []).map(clean),
      warnings: [],
      rating: d.mature ? "Mature" : "",
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

  global.Parsers = { SITES, extractUrls, canonical, siteOf, fetchUrl, fromUrl, parse, chapterPair };
})(typeof window !== "undefined" ? window : globalThis);
