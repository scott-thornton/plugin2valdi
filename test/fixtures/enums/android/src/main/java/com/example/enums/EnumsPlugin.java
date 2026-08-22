package com.example.enums;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Enums")
public class EnumsPlugin extends Plugin {

    private String currentMode = "native";

    @PluginMethod
    public void configure(PluginCall call) {
        String mode = call.getString("mode");
        currentMode = mode;
        String style = call.getString("style", "DARK");
        JSObject data = new JSObject();
        data.put("mode", mode);
        notifyListeners("modeDetected", data);
        call.resolve();
    }

    @PluginMethod
    public void getMode(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", currentMode);
        call.resolve(ret);
    }

    @PluginMethod
    public void echoMode(PluginCall call) {
        String mode = call.getString("mode");
        String style = call.getString("style", "LIGHT");
        JSObject ret = new JSObject();
        ret.put("mode", mode);
        ret.put("style", style);
        ret.put("origin", "north");
        call.resolve(ret);
    }
}
