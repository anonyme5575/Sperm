package com.duo.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Sortie de secours si l'écran Duo devient inaccessible :
 *   adb shell am broadcast -n com.duo.kiosk/.RescueReceiver
 * Ajouter « --ez unowner true » pour retirer aussi les droits de propriétaire.
 */
public class RescueReceiver extends BroadcastReceiver {
    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context c, Intent intent) {
        Duo.exit(c);
        if (intent.getBooleanExtra("unowner", false) && Duo.isOwner(c)) {
            Duo.dpm(c).clearDeviceOwnerApp(c.getPackageName());
        }
    }
}
