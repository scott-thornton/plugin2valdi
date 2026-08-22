package com.example.multiresolve;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Multi")
public class MultiPlugin extends Plugin {
    @PluginMethod
    public void getA(PluginCall call) { call.resolve(new JSObject().put("a", "x")); }
    @PluginMethod
    public void getB(PluginCall call) { call.resolve(new JSObject().put("b", 2)); }
    @PluginMethod
    public void getC(PluginCall call) { call.resolve(new JSObject().put("c", true)); }
}
