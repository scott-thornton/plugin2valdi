package com.example.basic;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Basic")
public class BasicPlugin extends Plugin {

    private String mode = "fast";

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", true);
        ret.put("mode", mode);
        ret.put("label", "ok");
        call.resolve(ret);
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        JSObject data = new JSObject();
        data.put("mode", mode);
        notifyListeners("statusChanged", data);
        call.resolve();
    }
}
