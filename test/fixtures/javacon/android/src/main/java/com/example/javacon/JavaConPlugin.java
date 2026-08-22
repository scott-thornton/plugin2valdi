package com.example.javacon;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

@CapacitorPlugin(name = "JavaCon")
public class JavaConPlugin extends Plugin {

    private java.util.List<String> words = new java.util.ArrayList<>(java.util.Arrays.asList("alpha", "beta"));

    @PluginMethod
    public void echo(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("message required");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("message", message + "-ok");
        call.resolve(ret);
    }

    @PluginMethod
    public void probe(PluginCall call) {
        double count = call.getDouble("count", 3.0);
        boolean active = call.getBoolean("active", true);
        JSObject ret = new JSObject();
        ret.put("count", count * 2);
        ret.put("active", active);
        call.resolve(ret);
    }

    @PluginMethod
    public void tally(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("words", new JSArray(words.toArray(new String[0])));
        } catch (JSONException e) {
            call.reject("serialize failed", e);
            return;
        }
        ret.put("total", words.size());
        call.resolve(ret);
    }
}
