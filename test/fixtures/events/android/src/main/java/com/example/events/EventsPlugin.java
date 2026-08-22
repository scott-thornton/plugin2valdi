package com.example.events;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Events")
public class EventsPlugin extends Plugin {

    private String lastBarcode = "0123456789";
    private String lastError = "decoder timed out";

    @PluginMethod
    public void startScanning(PluginCall call) {
        JSObject data = new JSObject();
        data.put("barcode", lastBarcode);
        data.put("format", "QR");
        notifyListeners("scanCompleted", data);
        call.resolve();
    }

    @PluginMethod
    public void getLastScan(PluginCall call) {
        JSObject err = new JSObject();
        err.put("message", lastError);
        notifyListeners("decodeError", err);
        JSObject ret = new JSObject();
        ret.put("barcode", lastBarcode);
        ret.put("format", "QR");
        call.resolve(ret);
    }
}
