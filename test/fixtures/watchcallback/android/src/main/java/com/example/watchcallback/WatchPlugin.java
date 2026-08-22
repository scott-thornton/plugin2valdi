package com.example.watchcallback;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Watch")
public class WatchPlugin extends Plugin {
    @PluginMethod
    public void getPosition(PluginCall call) { call.resolve(new JSObject().put("lat", 1.0).put("lng", 2.0)); }
    @PluginMethod
    public void watch(PluginCall call) { call.resolve(new JSObject().put("id", "w1")); }
    @PluginMethod
    public void stopWatch(PluginCall call) { call.resolve(); }
    @PluginMethod
    public void getSecurity(PluginCall call) { call.resolve(new JSObject().put("state", "granted")); }
}
