package com.example.jparam;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Jparam")
public class JparamPlugin extends Plugin {

    private java.util.List<String> items = new java.util.ArrayList<>(java.util.Arrays.asList("a", "b", "c"));

    @PluginMethod
    public void list(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("items", new java.util.ArrayList<>(items));
        call.resolve(ret);
    }

    @PluginMethod
    public void count(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("count", items.size());
        call.resolve(ret);
    }

    @PluginMethod
    public void describe(PluginCall call) {
        String label = call.getString("label");
        if (label == null) {
            call.reject("label required");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("label", label);
        ret.put("active", items.contains(label));
        call.resolve(ret);
    }
}
