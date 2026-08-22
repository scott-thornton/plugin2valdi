package com.example.params;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Params")
public class ParamsPlugin extends Plugin {

    private java.util.Map<String, String> store = new java.util.HashMap<>();

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key required");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("value", store.get(key));
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key required");
            return;
        }
        String value = call.getString("value", "");
        store.put(key, value);
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String group = call.getString("group");
        call.resolve();
    }

    @PluginMethod
    public void keys(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("keys", new java.util.ArrayList<>(store.keySet()));
        call.resolve(ret);
    }
}
