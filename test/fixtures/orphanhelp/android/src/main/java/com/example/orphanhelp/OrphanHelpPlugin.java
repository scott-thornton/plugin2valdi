package com.example.orphanhelp;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionCallback;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OrphanHelp")
public class OrphanHelpPlugin extends Plugin {

    private Greeter greeter;

    @PluginMethod
    public void ping(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("pong", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void notHere(PluginCall call) {
        call.unimplemented();
    }

    @PluginMethod
    public void greet(PluginCall call) {
        String who = call.getString("who");
        greeter.greet(who);
        call.resolve();
    }

    void onGreetingEvent(String which) {
        JSObject data = new JSObject();
        data.put("which", Greeter.GREETING_HI);
        notifyListeners("greeted", data);
        bridge.triggerWindowJSEvent("greeted", data);
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        call.resolve();
    }
}
