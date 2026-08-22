package com.plugin2valdi.modules.clipboard;

import com.snap.valdi.promise.Promise;
import com.snap.valdi.promise.ResolvablePromise;
import android.annotation.TargetApi;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;

// RN source: ClipboardModule.java - translated by the plugin2valdi RN intake.
// @ReactModule registration replaced by clipboard_factory.kt; Promise
// params became ResolvablePromise bodies; ReactApplicationContext became
// the appContext() helper (Valdi runtimes carry the app Context).
class ClipboardModuleImpl implements ClipboardModule {

    private ClipboardListener valdiListener = null;

    public static final String CLIPBOARD_TEXT_CHANGED = "RNCClipboard_TEXT_CHANGED";
    private ClipboardManager.OnPrimaryClipChangedListener listener = null;
    public static final String MIMETYPE_JPEG = "image/jpeg";
    public static final String MIMETYPE_JPG = "image/jpg";
    public static final String MIMETYPE_PNG = "image/png";
    public static final String MIMETYPE_WEBP = "image/webp";
    public static final String MIMETYPE_HEIC = "image/heic";
    public static final String MIMETYPE_HEIF = "image/heif";

    @Override
    public Promise<String> getString() {
        ResolvablePromise<String> valdiPromise = new ResolvablePromise<>();
            try {
              ClipboardManager clipboard = getClipboardService();
              ClipData clipData = clipboard.getPrimaryClip();
              if (clipData != null && clipData.getItemCount() >= 1) {
        ClipData.Item firstItem = clipData.getItemAt(0);
        valdiPromise.fulfillSuccess("" + firstItem.getText());
              } else {
        valdiPromise.fulfillSuccess("");
              }
            } catch (Exception e) {
              valdiPromise.fulfillFailure(new RuntimeException(String.valueOf(e)));
            }
        return valdiPromise;
    }

    @Override
    public Promise<java.util.List<String>> getStrings() {
        ResolvablePromise<java.util.List<String>> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("getStrings is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<String> getImagePNG() {
        ResolvablePromise<String> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("getImagePNG is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<String> getImageJPG() {
        ResolvablePromise<String> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("getImageJPG is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<kotlin.Unit> setImage(SetImageOptions options) {
        ResolvablePromise<kotlin.Unit> valdiPromise = new ResolvablePromise<>();
        String content = options.getContent();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("setImage is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<String> getImage() {
        ResolvablePromise<String> valdiPromise = new ResolvablePromise<>();
            ClipboardManager clipboardManager = getClipboardService();
            if (!(clipboardManager.hasPrimaryClip())){
              valdiPromise.fulfillSuccess("");
            }
            else if (clipboardManager.getPrimaryClipDescription().hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)){
              valdiPromise.fulfillSuccess("");
            }
            else {
              ClipData clipData = clipboardManager.getPrimaryClip();
              if(clipData != null){
        ClipData.Item item = clipData.getItemAt(0);
        Uri pasteUri = item.getUri();
        if (pasteUri != null){
          ContentResolver cr = appContext().getContentResolver();
          String mimeType = cr.getType(pasteUri);
          if (mimeType != null){
            try {
              Bitmap bitmap = MediaStore.Images.Media.getBitmap(cr, pasteUri);
              ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
              switch(mimeType){
                case MIMETYPE_JPEG:
                case MIMETYPE_JPG:
                  bitmap.compress(Bitmap.CompressFormat.JPEG, 100, outputStream);
                  break;
                case MIMETYPE_PNG:
                case MIMETYPE_HEIC:
                case MIMETYPE_HEIF:
                  bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream);
                  break;
                case MIMETYPE_WEBP:
                  if (Build.VERSION.SDK_INT > Build.VERSION_CODES.Q){
                    bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSLESS, 100, outputStream);
                    break;
                  }
                  bitmap.compress(Bitmap.CompressFormat.WEBP, 100, outputStream);
                  break;
                default:
                  return valdiPromise;
              }
              byte[] byteArray = outputStream.toByteArray();
              String encodedString = Base64.encodeToString(byteArray, Base64.DEFAULT);
              valdiPromise.fulfillSuccess("data:" + mimeType + ";base64," + encodedString);
            } catch (IOException e) {
              valdiPromise.fulfillFailure(new RuntimeException(String.valueOf(e)));
              e.printStackTrace();
            }
          }
        }
              }
              valdiPromise.fulfillSuccess("");
            }
        return valdiPromise;
    }

    @Override
    public void setString(SetStringOptions options) {
        String text = options.getContent();
            try {
              ClipData clipdata = ClipData.newPlainText(null, text);
              ClipboardManager clipboard = getClipboardService();
              clipboard.setPrimaryClip(clipdata);
            } catch (Exception e) {
              e.printStackTrace();
            }
    }

    @Override
    public void setStrings(SetStringsOptions options) {
        java.util.List<String> content = options.getContent();

    }

    @Override
    public Promise<Boolean> hasString() {
        ResolvablePromise<Boolean> valdiPromise = new ResolvablePromise<>();
            try {
              ClipboardManager clipboard = getClipboardService();
              ClipData clipData = clipboard.getPrimaryClip();
              valdiPromise.fulfillSuccess(clipData != null && clipData.getItemCount() >= 1);
            } catch (Exception e) {
              valdiPromise.fulfillFailure(new RuntimeException(String.valueOf(e)));
            }
        return valdiPromise;
    }

    @Override
    public Promise<Boolean> hasImage() {
        ResolvablePromise<Boolean> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("hasImage is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<Boolean> hasURL() {
        ResolvablePromise<Boolean> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("hasURL is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<Boolean> hasNumber() {
        ResolvablePromise<Boolean> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("hasNumber is not supported on Android")));
        return valdiPromise;
    }

    @Override
    public Promise<Boolean> hasWebURL() {
        ResolvablePromise<Boolean> valdiPromise = new ResolvablePromise<>();
            valdiPromise.fulfillFailure(new RuntimeException(String.valueOf("hasWebURL is not supported on Android")));
        return valdiPromise;
    }

  private ClipboardManager getClipboardService() {
    return (ClipboardManager) appContext().getSystemService(Context.CLIPBOARD_SERVICE);
  }

    @Override
    public void setListener(ClipboardListener listenerSlot) {
        this.valdiListener = listenerSlot;
        if (listener != null) {
            try {
              ClipboardManager clipboard = getClipboardService();
              listener = new ClipboardManager.OnPrimaryClipChangedListener() {
        @Override
        public void onPrimaryClipChanged() {
          if (valdiListener != null) valdiListener.textChanged("");
        }
              };
              clipboard.addPrimaryClipChangedListener(listener);
            } catch (Exception e) {
              e.printStackTrace();
            }
        }
        if (listener == null) {
            if(listener != null){
              try{
        ClipboardManager clipboard = getClipboardService();
        clipboard.removePrimaryClipChangedListener(listener);
              } catch (Exception e) {
        e.printStackTrace();
              }
            }
        }
    }

    public void onLoad() {
        // plugin2valdi: RN modules have no load lifecycle - empty anchor for the factory.
    }

    // plugin2valdi: Valdi runtime that loaded this module carries the app
    // Context (factories run inside a live runtime by construction).
    private static android.content.Context appContext() {
        java.util.List<com.snap.valdi.ValdiRuntime> runtimes = com.snap.valdi.ValdiRuntimeManager.allRuntimes();
        return runtimes.isEmpty() ? null : runtimes.get(0).getContext();
    }

    @Override
    public int pushToMarshaller(com.snap.valdi.utils.ValdiMarshaller marshaller) {
        return ClipboardModule.DefaultImpls.pushToMarshaller(this, marshaller);
    }
}
