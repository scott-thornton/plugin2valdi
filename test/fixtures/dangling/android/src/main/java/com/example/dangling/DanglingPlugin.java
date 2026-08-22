package com.example.dangling;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Dangling")
public class DanglingPlugin extends Plugin {

    @PluginMethod
    public void ping(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("alive", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        call.resolve();
    }
}
