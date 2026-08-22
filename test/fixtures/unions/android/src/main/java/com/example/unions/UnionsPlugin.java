package com.example.unions;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Unions")
public class UnionsPlugin extends Plugin {

    private String flavor = "sweet";
    private String origin = "north";

    @PluginMethod
    public void getTaste(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("flavor", flavor);
        ret.put("heat", "low");
        ret.put("origin", origin);
        ret.put("note", JSObject.NULL);
        call.resolve(ret);
    }

    @PluginMethod
    public void setFlavor(PluginCall call) {
        flavor = call.getString("flavor");
        call.resolve();
    }

    @PluginMethod
    public void getDirection(PluginCall call) {
        call.resolve(flavor);
    }

    @PluginMethod
    public void getRawDirection(PluginCall call) {
        call.resolve(origin);
    }

    @PluginMethod
    public void getNote(PluginCall call) {
        call.resolve();
    }
}
