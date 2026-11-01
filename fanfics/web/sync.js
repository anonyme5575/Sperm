// Synchronisation entre téléphones par un fichier sur Google Drive.
// L'app lie un fichier (créé sur Drive, ou celui d'un autre téléphone) avec le sélecteur de fichiers d'Android,
// puis à chaque synchro : lit le fichier, fusionne, réécrit. Pas de compte à configurer : Drive s'occupe du transport.
//
// Fusion : chaque fanfic et chaque auteur porte « mtime », la date de sa dernière modification sur un téléphone ;
// la version la plus récente gagne. Les suppressions sont notées (deleted) pour ne pas ressusciter d'un autre appareil.
(function () {
  "use strict";
  const A = window.FanficsApp;
  const P = window.Parsers;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const FILE = "mes-fanfics-synchro.json";
  const KEEP_DELETED = 120 * 24 * 3600 * 1000; // une suppression est retenue 4 mois

  const fkey = (f) => P.storyKey(f.url);
  const akey = (a) => "a:" + a.site + ":" + a.id;

  function st() {
    const s = A.settings.sync || (A.settings.sync = {});
    s.deleted = s.deleted || {};
    s.hashes = s.hashes || {};
    return s;
  }
  const linked = () => A.native && typeof Android.syncName === "function" && !!Android.syncName();

  // Empreinte d'un objet sans sa date de modification : sert à repérer ce qui a changé depuis la dernière synchro.
  function hash(o) {
    const s = JSON.stringify(o, (k, v) => (k === "mtime" ? undefined : v));
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    return x.toString(36);
  }

  // Date les objets modifiés depuis la dernière synchro.
  function stamp() {
    const s = st(), now = Date.now();
    for (const f of A.fics) if (s.hashes[fkey(f)] !== hash(f)) f.mtime = now;
    for (const a of A.authors) if (s.hashes[akey(a)] !== hash(a)) a.mtime = now;
  }

  function rehash() {
    const s = st();
    s.hashes = {};
    for (const f of A.fics) s.hashes[fkey(f)] = hash(f);
    for (const a of A.authors) s.hashes[akey(a)] = hash(a);
  }

  // Une fanfic ou un auteur supprimé : retenu pour la fusion.
  // La date retenue dépasse la dernière version connue, même si l'horloge d'un autre téléphone avance.
  function markDeleted(key, lastMtime) { st().deleted[key] = Math.max(Date.now(), (lastMtime || 0) + 1); }

  function mergeList(local, remote, key, deleted, fresh) {
    const map = new Map();
    for (const l of local) map.set(key(l), { l });
    for (const r of remote || []) { const k = key(r); (map.get(k) || map.set(k, {}).get(k)).r = r; }
    const out = [];
    for (const [k, { l, r }] of map) {
      const lt = (l && l.mtime) || 0, rt = (r && r.mtime) || 0;
      if (deleted[k] && deleted[k] >= Math.max(lt, rt)) continue; // supprimé après sa dernière modification
      if (l && r && rt > lt) out.push(Object.assign(l, r, l.id ? { id: l.id } : {})); // même objet : le lecteur ouvert le garde
      else if (l) out.push(l);
      else out.push(fresh(r));
    }
    return out;
  }

  function merge(remote) {
    const s = st(), now = Date.now();
    const deleted = Object.assign({}, s.deleted);
    for (const [k, t] of Object.entries(remote.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
    for (const k of Object.keys(deleted)) if (now - deleted[k] > KEEP_DELETED) delete deleted[k];
    const fics = mergeList(A.fics, remote.fics, fkey, deleted,
      (r) => Object.assign({ id: r.id || now.toString(36) + Math.random().toString(36).slice(2, 7), shelves: [], fandoms: [], tags: [], status: "toread", stars: 0, lastRead: 0 }, r));
    const authors = mergeList(A.authors, remote.authors, akey, deleted, (r) => r);
    for (const a of remote.accounts || []) if (!A.settings.accounts.some((x) => x.url === a.url)) A.settings.accounts.push(a);
    s.deleted = deleted;
    return { fics, authors };
  }

  // ------------------------------------------------------------ synchroniser

  let busy = false, again = false, applying = false, timer = 0;

  async function syncNow(quiet) {
    if (!linked()) return;
    if (busy) { again = true; return; }
    busy = true;
    render("Synchronisation…");
    try {
      stamp();
      const text = await A.nativeCall("syncRead");
      let remote = {};
      if (text && text.trim()) {
        try { remote = JSON.parse(text); } catch (e) { throw new Error("Ce fichier n'est pas une synchro Mes Fanfics."); }
        if (!remote || (!Array.isArray(remote.fics) && !Array.isArray(remote.authors))) throw new Error("Ce fichier n'est pas une synchro Mes Fanfics.");
      }
      const before = A.fics.length;
      const m = merge(remote);
      applying = true;
      A.replaceData(m.fics, m.authors);
      rehash();
      st().last = Date.now();
      A.flush();
      applying = false;
      await A.nativeCall("syncWrite", JSON.stringify({
        app: "mes-fanfics", version: 1, savedAt: new Date().toISOString(),
        fics: A.fics, authors: A.authors, deleted: st().deleted, accounts: A.settings.accounts,
      }));
      const diff = A.fics.length - before;
      if (!quiet) A.toast("Synchronisé avec Google Drive" + (diff > 0 ? ` : ${diff} fanfic${diff > 1 ? "s" : ""} reçue${diff > 1 ? "s" : ""}.` : "."));
      render();
    } catch (e) {
      applying = false;
      render("Synchro impossible : " + e.message);
      if (!quiet) A.toast("Synchro impossible : " + e.message);
    } finally {
      busy = false;
      if (again) { again = false; syncNow(true); }
    }
  }

  // Après chaque modification : synchro groupée 20 s plus tard (Drive n'aime pas les écritures en rafale).
  A.onSaved = () => {
    if (applying || !linked()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(true), 20000);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && timer) { clearTimeout(timer); timer = 0; syncNow(true); }
  });

  // ------------------------------------------------------------ réglages

  function render(msg) {
    const box = $("syncBox");
    if (!box) return;
    if (!A.native) { box.innerHTML = `<p class="hint">Disponible dans l'app Android.</p>`; return; }
    if (!linked()) {
      box.innerHTML = `<p class="hint">Garde ta liste, tes auteurs et ta progression de lecture sur ton compte Google : l'app les enregistre dans un fichier de ton Google Drive. Sur un autre téléphone, installe l'app et lie le même fichier.</p>
        <button class="item" data-sync="create">☁️ Créer le fichier sur Google Drive</button>
        <button class="item" data-sync="open">📲 J'ai déjà un fichier (autre téléphone)</button>
        <p class="hint">Dans le sélecteur qui s'ouvre, choisis <b>Drive</b> dans le menu ☰ (l'app Google Drive doit être installée).</p>`;
      return;
    }
    const last = st().last;
    box.innerHTML = `<div class="acc"><span>☁️ ${esc(Android.syncName())}<small>${esc(msg || (last ? "Dernière synchro : " + new Date(last).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Pas encore synchronisé"))}</small></span>
      <button class="primary" data-sync="now">Synchroniser</button><button class="ghost" data-sync="unlink">✕</button></div>`;
  }

  $("syncBox").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sync]");
    if (!b) return;
    const act = b.dataset.sync;
    if (act === "create") Android.syncCreate(FILE);
    else if (act === "open") Android.syncOpen();
    else if (act === "now") syncNow(false);
    else if (act === "unlink" && confirm("Arrêter la synchronisation avec ce fichier ? Ta liste reste sur ce téléphone et le fichier reste sur Drive.")) {
      Android.syncUnlink();
      render();
    }
  });
  $("btnMenu").addEventListener("click", () => render());

  // Fichier lié (créé ou ouvert) : première synchro tout de suite.
  window.__syncLinked = () => { render(); syncNow(false); };

  // Au démarrage et au retour dans l'app : récupère ce que l'autre téléphone a changé.
  const resume = window.__resume;
  window.__resume = () => {
    if (resume) resume();
    if (linked() && Date.now() - (st().last || 0) > 60000) syncNow(true);
  };
  if (A.native) setTimeout(() => { if (linked()) syncNow(true); }, 1500);

  A.markDeleted = markDeleted;
  A.sync = { syncNow, merge, stamp };
})();
