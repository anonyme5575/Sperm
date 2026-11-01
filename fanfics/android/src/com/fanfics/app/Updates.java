package com.fanfics.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Vérification des nouveaux chapitres en arrière-plan, sans WebView (peu de mémoire, peu de batterie).
 *
 * Toutes les 4 h environ, quand il y a du réseau, Android lance ce JobService. Il lit la liste enregistrée
 * par l'app (files/fanfics.json) et regarde, avec des requêtes légères :
 *  - les auteurs favoris AO3 et Wattpad : une page par auteur donne ses histoires récentes et leurs chapitres
 *    (nouvelle histoire ou nouveaux chapitres) ;
 *  - les fanfics « en cours » AO3 et Wattpad pas encore terminées.
 * FanFiction.net n'est pas lisible sans navigateur (protection anti-robot) : il est vérifié à l'ouverture de l'app.
 * Les nouveautés sont notifiées et gardées dans files/updates-pending.json pour l'app.
 */
public class Updates extends JobService {
    static final int JOB_ID = 42;
    static final String CHANNEL = "chapitres";
    private static final long PERIOD_MS = 4L * 60 * 60 * 1000;
    private static final int MAX_FICS = 40;
    private Thread worker;

    // ------------------------------------------------------------ planification

    static void schedule(Context c, boolean on) {
        // Créée app ouverte : sur Android 13+, c'est ce qui fait apparaître la demande d'autorisation.
        if (on) channel(c);
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        if (!on) { js.cancel(JOB_ID); return; }
        for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return; // déjà planifié
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, Updates.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS)
                .setPersisted(true) // survit au redémarrage du téléphone
                .build());
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                try { check(Updates.this); } catch (Throwable ignored) { }
                jobFinished(params, false);
            }
        });
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        if (worker != null) worker.interrupt();
        return true;
    }

    // ------------------------------------------------------------ vérification

    /** Lance une vérification complète ; renvoie le nombre de nouveautés trouvées. */
    static synchronized int check(Context c) throws Exception {
        JSONObject data = readJson(new File(c.getFilesDir(), "fanfics.json"));
        if (data == null) return 0;
        JSONObject settings = data.optJSONObject("settings");
        if (settings != null && !settings.optBoolean("notify", true)) return 0;

        File stateFile = new File(c.getFilesDir(), "updates-state.json");
        JSONObject state = readJson(stateFile);
        if (state == null) state = new JSONObject();
        JSONObject seenAuthors = state.optJSONObject("authors");
        if (seenAuthors == null) state.put("authors", seenAuthors = new JSONObject());
        JSONObject seenFics = state.optJSONObject("fics");
        if (seenFics == null) state.put("fics", seenFics = new JSONObject());

        List<JSONObject> events = new ArrayList<>();
        java.util.Set<String> covered = new java.util.HashSet<>();

        // Auteurs favoris.
        JSONArray authors = data.optJSONArray("authors");
        for (int i = 0; authors != null && i < authors.length(); i++) {
            if (Thread.interrupted()) return 0;
            JSONObject a = authors.getJSONObject(i);
            String site = a.optString("site"), id = a.optString("id"), name = a.optString("name", id);
            if (!"ao3".equals(site) && !"wattpad".equals(site)) continue;
            Map<String, Work> works;
            try { works = "ao3".equals(site) ? ao3Works(id) : wattpadWorks(id); } catch (Exception e) { continue; }
            if (works == null) continue;
            String key = site + ":" + id;
            JSONObject before = seenAuthors.optJSONObject(key);
            JSONObject now = new JSONObject();
            for (Work w : works.values()) {
                now.put(w.key, w.chapters);
                covered.add(w.key);
                if (before == null) continue; // premier passage : on note sans notifier
                if (!before.has(w.key)) events.add(event("story", w, name, 0));
                else if (w.chapters > before.optInt(w.key)) events.add(event("chapters", w, name, w.chapters - before.optInt(w.key)));
            }
            // Garde aussi les anciennes histoires sorties de la première page.
            if (before != null) for (Iterator<String> it = before.keys(); it.hasNext(); ) {
                String k = it.next();
                if (!now.has(k)) now.put(k, before.optInt(k));
            }
            seenAuthors.put(key, now);
            Thread.sleep(1500); // AO3 limite le nombre de pages par minute
        }

        // Fanfics en cours, pas terminées, pas déjà vues chez un auteur favori.
        JSONArray fics = data.optJSONArray("fics");
        int done = 0;
        for (int i = 0; fics != null && i < fics.length() && done < MAX_FICS; i++) {
            if (Thread.interrupted()) return 0;
            JSONObject f = fics.getJSONObject(i);
            if (!"reading".equals(f.optString("status")) || f.optBoolean("complete")) continue;
            Work w = workOf(f);
            if (w == null || covered.contains(w.key)) continue;
            done++;
            int n;
            try { n = "ao3".equals(w.site) ? ao3Chapters(w.id) : wattpadParts(w.id); } catch (Exception e) { continue; }
            if (n <= 0) continue;
            int known = seenFics.has(w.key) ? seenFics.optInt(w.key) : f.optInt("chapters", 0);
            if (known > 0 && n > known) events.add(event("chapters", w, f.optString("author"), n - known));
            seenFics.put(w.key, n);
            Thread.sleep(1500);
        }

        writeJson(stateFile, state);
        if (events.isEmpty()) return 0;
        File pendingFile = new File(c.getFilesDir(), "updates-pending.json");
        JSONObject pending = readJson(pendingFile);
        JSONArray list = pending != null && pending.optJSONArray("events") != null ? pending.optJSONArray("events") : new JSONArray();
        for (JSONObject e : events) list.put(e);
        writeJson(pendingFile, new JSONObject().put("events", list));
        notify(c, events);
        return events.size();
    }

    static JSONArray takePending(Context c) {
        File f = new File(c.getFilesDir(), "updates-pending.json");
        JSONObject p = readJson(f);
        f.delete();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(JOB_ID);
        return p != null && p.optJSONArray("events") != null ? p.optJSONArray("events") : new JSONArray();
    }

    private static JSONObject event(String kind, Work w, String author, int added) throws Exception {
        return new JSONObject().put("kind", kind).put("site", w.site).put("url", w.url).put("title", w.title)
                .put("author", author).put("chapters", w.chapters).put("added", added).put("t", System.currentTimeMillis());
    }

    // ------------------------------------------------------------ notification

    private static void notify(Context c, List<JSONObject> events) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        channel(c);
        Notification.InboxStyle box = new Notification.InboxStyle();
        String first = null;
        for (JSONObject e : events) {
            String line = "story".equals(e.optString("kind"))
                    ? e.optString("author") + " a publié « " + e.optString("title") + " »"
                    : "« " + e.optString("title") + " » : +" + e.optInt("added") + " chapitre" + (e.optInt("added") > 1 ? "s" : "");
            if (first == null) first = line;
            box.addLine(line);
        }
        String title = events.size() == 1 ? "Nouveauté de tes fanfics" : events.size() + " nouveautés dans tes fanfics";
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | 0x04000000 /* IMMUTABLE */);
        nm.notify(JOB_ID, new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(title)
                .setContentText(first)
                .setStyle(box)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build());
    }

    static void channel(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Nouveaux chapitres", NotificationManager.IMPORTANCE_DEFAULT));
    }

    // ------------------------------------------------------------ sites (requêtes légères)

    static final class Work {
        String site, id, key, url, title;
        int chapters;
    }

    private static Work work(String site, String id, String title, int chapters) {
        Work w = new Work();
        w.site = site;
        w.id = id;
        w.title = title;
        w.chapters = chapters;
        w.key = site + ":" + id;
        w.url = "ao3".equals(site) ? "https://archiveofourown.org/works/" + id : "https://www.wattpad.com/story/" + id;
        return w;
    }

    private static Work workOf(JSONObject f) {
        String url = f.optString("url");
        Matcher m = Pattern.compile("archiveofourown\\.org/works/(\\d+)").matcher(url);
        if (m.find()) return work("ao3", m.group(1), f.optString("title"), f.optInt("chapters"));
        m = Pattern.compile("wattpad\\.com/story/(\\d+)").matcher(url);
        if (m.find()) return work("wattpad", m.group(1), f.optString("title"), f.optInt("chapters"));
        return null;
    }

    private static String get(String url) throws Exception {
        JSONObject r = MainActivity.download(url);
        if (!r.optBoolean("ok")) throw new Exception(r.optString("error"));
        return r.optString("body");
    }

    private static final Pattern AO3_TITLE = Pattern.compile("<h4 class=\"heading\">\\s*<a href=\"/works/\\d+\">([^<]*)</a>");
    private static final Pattern AO3_CHAPTERS = Pattern.compile("<dd class=\"chapters\">(.*?)</dd>", Pattern.DOTALL);

    /** Première page des œuvres d'un auteur AO3 (les plus récemment mises à jour). */
    static Map<String, Work> ao3Works(String user) throws Exception {
        return parseAo3Works(get("https://archiveofourown.org/users/" + user + "/works"));
    }

    static Map<String, Work> parseAo3Works(String html) {
        Map<String, Work> out = new LinkedHashMap<>();
        String[] parts = html.split("<li id=\"work_");
        for (int i = 1; i < parts.length; i++) {
            String p = parts[i];
            Matcher id = Pattern.compile("^(\\d+)").matcher(p);
            if (!id.find()) continue;
            Matcher t = AO3_TITLE.matcher(p), ch = AO3_CHAPTERS.matcher(p);
            int n = ch.find() ? firstNumber(ch.group(1).replaceAll("<[^>]+>", "")) : 0;
            Work w = work("ao3", id.group(1), t.find() ? unescape(t.group(1)) : "", n);
            out.put(w.key, w);
        }
        return out;
    }

    static int ao3Chapters(String workId) throws Exception {
        return countAo3Chapters(get("https://archiveofourown.org/works/" + workId + "/navigate?view_adult=true"), workId);
    }

    static int countAo3Chapters(String html, String workId) {
        Matcher m = Pattern.compile("href=\"/works/" + workId + "/chapters/\\d+\"").matcher(html);
        int n = 0;
        while (m.find()) n++;
        return n;
    }

    private static final String WP_FIELDS = "stories(id,title,numParts),nextUrl";

    static Map<String, Work> wattpadWorks(String user) throws Exception {
        String q = "?offset=0&limit=50&fields=" + WP_FIELDS;
        String[] urls = {
            "https://www.wattpad.com/v4/users/" + user + "/stories/published" + q,
            "https://www.wattpad.com/api/v3/users/" + user + "/stories" + q,
            "https://www.wattpad.com/api/v3/users/" + user + "/stories/published" + q,
        };
        for (String u : urls) {
            JSONObject d;
            try { d = new JSONObject(get(u)); } catch (Exception e) { continue; }
            JSONArray s = d.optJSONArray("stories");
            if (s == null) continue;
            Map<String, Work> out = new LinkedHashMap<>();
            for (int i = 0; i < s.length(); i++) {
                JSONObject x = s.getJSONObject(i);
                Work w = work("wattpad", x.optString("id"), x.optString("title"), x.optInt("numParts"));
                out.put(w.key, w);
            }
            return out;
        }
        return null;
    }

    static int wattpadParts(String storyId) throws Exception {
        return new JSONObject(get("https://www.wattpad.com/api/v3/stories/" + storyId + "?fields=numParts")).optInt("numParts");
    }

    // ------------------------------------------------------------ outils

    static int firstNumber(String s) {
        Matcher m = Pattern.compile("(\\d[\\d,. ]*)").matcher(s);
        if (!m.find()) return 0;
        try { return Integer.parseInt(m.group(1).replaceAll("[^\\d]", "")); } catch (Exception e) { return 0; }
    }

    static String unescape(String s) {
        return s.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").trim();
    }

    static JSONObject readJson(File f) {
        if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            return new JSONObject(new String(b, 0, off, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    static void writeJson(File f, JSONObject o) {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        tmp.renameTo(f);
    }
}
