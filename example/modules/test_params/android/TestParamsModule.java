package com.plugin2valdi.modules.test_params;

import com.snap.valdi.promise.Promise;
import com.snap.valdi.promise.ResolvablePromise;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import kotlin.Unit;


class TestParamsModuleImpl implements TestParamsModule {

    private java.util.Map<String, String> store = new java.util.HashMap<>();

    @Override
    public Promise<GetResult> get(GetOptions options) {
        ResolvablePromise<GetResult> valdiPromise = new ResolvablePromise<>();
        try {

        String key = options.getKey();
        if (key == null) {
            valdiPromise.fulfillFailure(new RuntimeException("key required"));
            return valdiPromise;
        }
        JSONObject ret = new JSONObject();
        ret.put("value", store.get(key));
        valdiPromise.fulfillSuccess(makeGetResult(ret));
    
            return valdiPromise;
        } catch (org.json.JSONException e) {
            valdiPromise.fulfillFailure(new RuntimeException(e));
            return valdiPromise;
        }
    }

    @Override
    public Promise<kotlin.Unit> set(SetOptions options) {
        ResolvablePromise<kotlin.Unit> valdiPromise = new ResolvablePromise<>();

        String key = options.getKey();
        if (key == null) {
            valdiPromise.fulfillFailure(new RuntimeException("key required"));
            return valdiPromise;
        }
        String value = options.getValue() != null ? options.getValue() : "";
        store.put(key, value);
        valdiPromise.fulfillSuccess(kotlin.Unit.INSTANCE);
    
        return valdiPromise;
    }

    @Override
    public Promise<kotlin.Unit> configure(ConfigureOptions options) {
        ResolvablePromise<kotlin.Unit> valdiPromise = new ResolvablePromise<>();

        String group = options.getGroup();
        valdiPromise.fulfillSuccess(kotlin.Unit.INSTANCE);
    
        return valdiPromise;
    }

    @Override
    public Promise<KeysResult> keys() {
        ResolvablePromise<KeysResult> valdiPromise = new ResolvablePromise<>();
        try {

        JSONObject ret = new JSONObject();
        ret.put("keys", new java.util.ArrayList<>(store.keySet()));
        valdiPromise.fulfillSuccess(makeKeysResult(ret));
    
            return valdiPromise;
        } catch (org.json.JSONException e) {
            valdiPromise.fulfillFailure(new RuntimeException(e));
            return valdiPromise;
        }
    }

    public void onLoad() {
        // plugin2valdi: plugin had no load() - empty lifecycle anchor for the factory.
    }

    private static java.util.List<String> toStringList(org.json.JSONArray a) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        return out;
    }
    // dict-shaped -> typed struct bridge: positional ctor args follow the
    // emitted .d.ts field order, which is exactly the generated Kotlin
    // @ValdiClassConstructor order (both derive from the same contract).
    private static GetResult makeGetResult(JSONObject dict) {
        return new GetResult(dict.optString("value", null));
    }
    // dict-shaped -> typed struct bridge: positional ctor args follow the
    // emitted .d.ts field order, which is exactly the generated Kotlin
    // @ValdiClassConstructor order (both derive from the same contract).
    private static KeysResult makeKeysResult(JSONObject dict) {
        return new KeysResult(toStringList(dict.optJSONArray("keys")));
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
        return TestParamsModule.DefaultImpls.pushToMarshaller(this, marshaller);
    }
}


