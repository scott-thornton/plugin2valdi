package com.example.constevents;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionCallback;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ConstEvents")
public class ConstEventsPlugin extends Plugin {

    private static final String EVENT_STATE_CHANGE = "stateChange";
    private static final String EVENT_PAUSE = "pause";

    @PluginMethod
    public void exit(PluginCall call) {
        JSObject data = new JSObject();
        data.put("active", false);
        notifyListeners(EVENT_STATE_CHANGE, data, true);
        notifyListeners(EVENT_PAUSE, null, false);
        call.resolve();
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        call.resolve();
    }
}
