package com.plugin2valdi.modules.test_events;

import com.snap.valdi.promise.Promise;
import com.snap.valdi.promise.ResolvablePromise;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import kotlin.Unit;


class TestEventsModuleImpl implements TestEventsModule {

    private String lastBarcode = "0123456789";
    private String lastError = "decoder timed out";

    @Override
    public Promise<kotlin.Unit> startScanning() {
        ResolvablePromise<kotlin.Unit> valdiPromise = new ResolvablePromise<>();
        try {

        JSONObject data = new JSONObject();
        data.put("barcode", lastBarcode);
        data.put("format", "QR");
        emitScanCompleted(makeScanResult(data));
        valdiPromise.fulfillSuccess(kotlin.Unit.INSTANCE);
    
            return valdiPromise;
        } catch (org.json.JSONException e) {
            valdiPromise.fulfillFailure(new RuntimeException(e));
            return valdiPromise;
        }
    }

    @Override
    public Promise<ScanResult> getLastScan() {
        ResolvablePromise<ScanResult> valdiPromise = new ResolvablePromise<>();
        try {

        JSONObject err = new JSONObject();
        err.put("message", lastError);
        emitDecodeError(makestring(err));
        JSONObject ret = new JSONObject();
        ret.put("barcode", lastBarcode);
        ret.put("format", "QR");
        valdiPromise.fulfillSuccess(makeScanResult(ret));
    
            return valdiPromise;
        } catch (org.json.JSONException e) {
            valdiPromise.fulfillFailure(new RuntimeException(e));
            return valdiPromise;
        }
    }

    public void onLoad() {
        // plugin2valdi: plugin had no load() - empty lifecycle anchor for the factory.
    }

    // dict-shaped -> typed struct bridge: positional ctor args follow the
    // emitted .d.ts field order, which is exactly the generated Kotlin
    // @ValdiClassConstructor order (both derive from the same contract).
    private static ScanResult makeScanResult(JSONObject dict) {
        return new ScanResult(dict.optString("barcode", ""), dict.optString("format", ""));
    }
    // plugin2valdi: primitive string payload/result - heuristic dict extraction; review fidelity.
    private static String makestring(JSONObject dict) {
                // single-key dict (Capacitor's {"message": value} idiom for primitive
        // payloads) unwraps to the scalar - mirrors the Swift side's
        // c2vPrimitivePayload (data.values.first) fallback.
        if (dict != null && dict.length() == 1) return dict.optString(dict.keys().next());
        return dict == null ? null : dict.toString();
    }

    // plugin2valdi: events wired - setListener stores the generated TestEventsListener;
    // emit* forwards to it (null-safe, synchronized access; invoked
    // outside the lock).
    private TestEventsListener valdiListener;

    @Override
    public void setListener(TestEventsListener listener) {
        synchronized (this) {
            this.valdiListener = listener;
        }
    }

    private void emitScanCompleted(ScanResult payload) {
        TestEventsListener l;
        synchronized (this) { l = this.valdiListener; }
        if (l != null) l.scanCompleted(payload);
    }

    private void emitDecodeError(String payload) {
        TestEventsListener l;
        synchronized (this) { l = this.valdiListener; }
        if (l != null) l.decodeError(payload);
    }


    private static android.content.Context appContext() {
        // plugin2valdi: Valdi modules have no Capacitor bridge; the runtime that
        // loaded this module carries the app Context (factories are invoked
        // from JS, i.e. inside a live runtime - ValdiRuntimeManager.allRuntimes()
        // is non-empty by construction at module-load time).
        java.util.List<com.snap.valdi.ValdiRuntime> runtimes = com.snap.valdi.ValdiRuntimeManager.allRuntimes();
        return runtimes.isEmpty() ? null : runtimes.get(0).getContext();
    }

    @Override
    public int pushToMarshaller(com.snap.valdi.utils.ValdiMarshaller marshaller) {
        // Kotlin interface method with a body (no -Xjvm-default in the valdi
        // toolchain) is abstract at the JVM level - delegate to DefaultImpls
        // (compile-probe verified: a probe target).
        return TestEventsModule.DefaultImpls.pushToMarshaller(this, marshaller);
    }
}


