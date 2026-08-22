package com.example.multifile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Multi")
public class MultiPlugin extends Plugin {
    @PluginMethod
    public void ping(PluginCall call) { call.resolve(new JSObject().put("value", true)); }
    @PluginMethod
    public void run(PluginCall call) { call.resolve(new JSObject().put("ok", true)); }
    @PluginMethod
    public void initialize(PluginCall call) { call.resolve(); }
}
