package com.example.kotlinanno;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "KotlinAnno",
    permissions = {
        @Permission(
            strings = { "android.permission.CAMERA" },
            alias = "camera"
        )
    }
)
public class KotlinAnnoPlugin extends Plugin {
    @PluginMethod
    public void read(PluginCall call) { call.resolve(new JSObject().put("value", "v")); }
}
