package com.fanfics.app;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Map;

/**
 * Lecture des pages AO3 par la vérification en arrière-plan (Java, sans Android).
 *   javac -cp fanfics/android/build/classes:android/.tools/android.jar -d /tmp/t fanfics/tests/java/com/fanfics/app/UpdatesTest.java
 *   java -cp /tmp/t:fanfics/android/build/classes:android/.tools/android.jar com.fanfics.app.UpdatesTest fanfics/tests/pages
 */
public class UpdatesTest {
    static String read(String dir, String f) throws Exception {
        return new String(Files.readAllBytes(Paths.get(dir, f)), "UTF-8");
    }

    public static void main(String[] a) throws Exception {
        StringBuilder b = new StringBuilder();
        Map<String, Updates.Work> m = Updates.parseAo3Works(read(a[0], "ao3-search.html"));
        for (Updates.Work w : m.values()) b.append(w.key).append('=').append(w.title).append('/').append(w.chapters).append(';');
        String got = b + " nav=" + Updates.countAo3Chapters(read(a[0], "ao3-navigate.html"), "555")
                + " num=" + Updates.firstNumber("1,234/?") + " esc=" + Updates.unescape("One &amp; Done");
        String want = "ao3:555=Stars Fall/2;ao3:777=Hiver/1; nav=2 num=1234 esc=One & Done";
        System.out.println(got);
        if (!got.equals(want)) {
            System.out.println("ATTENDU " + want);
            System.exit(1);
        }
        System.out.println("Java : tout est bon.");
    }
}
