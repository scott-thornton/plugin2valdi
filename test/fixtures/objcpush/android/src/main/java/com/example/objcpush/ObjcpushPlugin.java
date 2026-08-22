package com.example.objcpush;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Objcpush")
public class ObjcpushPlugin extends Plugin {

    private int pingCount = 0;

    @PluginMethod
    public void echo(PluginCall call) {
        String message = call.getString("message", "hello");
        pingCount = pingCount + 1;
        JSObject response = new JSObject();
        response.put("message", message);
        response.put("count", pingCount);
        call.resolve(response);
    }

    @PluginMethod
    public void ping(PluginCall call) {
        if (pingCount <= 0) {
            call.reject("ping unavailable before echo");
            return;
        }
        notifyListeners("pushReceived", new JSObject() {{
            put("token", "fixed-token");
        }});
        call.resolve();
    }
}
