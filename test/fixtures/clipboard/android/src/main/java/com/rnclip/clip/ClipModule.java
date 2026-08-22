package com.rnclip.clip;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

@ReactModule(name = ClipModule.NAME)
public class ClipModule extends ReactContextBaseJavaModule {

  public static final String CLIP_TEXT_CHANGED = "RNCClipboard_TEXT_CHANGED";
  private ReactApplicationContext reactContext;
  private ClipboardManager.OnPrimaryClipChangedListener listener = null;

  public ClipModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  public static final String NAME = "RNCClip";

  private ClipboardManager getClipboardService() {
    return (ClipboardManager) reactContext.getSystemService(Context.CLIPBOARD_SERVICE);
  }

  @ReactMethod
  public void getString(Promise promise) {
    try {
      ClipboardManager clipboard = getClipboardService();
      ClipData clipData = clipboard.getPrimaryClip();
      if (clipData != null && clipData.getItemCount() >= 1) {
        promise.resolve("" + clipData.getItemAt(0).getText());
      } else {
        promise.resolve("");
      }
    } catch (Exception e) {
      promise.reject(e);
    }
  }

  @ReactMethod
  public void setString(String text) {
    try {
      ClipData clipdata = ClipData.newPlainText(null, text);
      ClipboardManager clipboard = getClipboardService();
      clipboard.setPrimaryClip(clipdata);
    } catch (Exception e) {
      e.printStackTrace();
    }
  }

  @ReactMethod
  public void hasString(Promise promise) {
    try {
      ClipboardManager clipboard = getClipboardService();
      ClipData clipData = clipboard.getPrimaryClip();
      promise.resolve(clipData != null && clipData.getItemCount() >= 1);
    } catch (Exception e) {
      promise.reject(e);
    }
  }

  @ReactMethod
  public void setListener() {
    try {
      ClipboardManager clipboard = getClipboardService();
      listener = new ClipboardManager.OnPrimaryClipChangedListener() {
        @Override
        public void onPrimaryClipChanged() {
          reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(CLIP_TEXT_CHANGED, null);
        }
      };
      clipboard.addPrimaryClipChangedListener(listener);
    } catch (Exception e) {
      e.printStackTrace();
    }
  }

  @ReactMethod
  public void removeListener() {
    if(listener != null){
      ClipboardManager clipboard = getClipboardService();
      clipboard.removePrimaryClipChangedListener(listener);
    }
  }

  @ReactMethod
  public void addListener(String eventName) {
    // Keep: Required for RN built in Event Emitter Calls.
  }

  @ReactMethod
  public void removeListeners(Integer count) {
    // Keep: Required for RN built in Event Emitter Calls.
  }
}
