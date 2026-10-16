package com.moniteur.pc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Relance la surveillance au démarrage du téléphone, si un PC a déjà été trouvé. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && Pc.host(c) != null) {
            c.startForegroundService(new Intent(c, WatchService.class));
        }
    }
}
