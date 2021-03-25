/**
 * Copyright (C) 2017 SIL International. All rights reserved.
 */

package com.keyman.android;

import com.tavultesoft.kmapro.BuildConfig;
import com.tavultesoft.kmea.KMManager;
import com.tavultesoft.kmea.KMManager.KeyboardType;
import com.tavultesoft.kmea.KMHardwareKeyboardInterpreter;
import com.tavultesoft.kmea.KeyboardEventHandler.OnKeyboardEventListener;
import com.tavultesoft.kmea.R;
import com.tavultesoft.kmea.data.Keyboard;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Point;
import android.inputmethodservice.InputMethodService;
import android.text.InputType;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.InputConnection;
import android.widget.FrameLayout;

import io.sentry.android.core.SentryAndroid;
import io.sentry.Sentry;

public class SystemKeyboard extends InputMethodService implements OnKeyboardEventListener {

  private static View inputView = null;
  private static ExtractedText exText = null;
  private static boolean isNumericField = false;
  private KMHardwareKeyboardInterpreter interpreter = null;

  private static final String TAG = "SystemKeyboard";

  /**
   * Main initialization of the input method component. Be sure to call
   * to super class.
   */
  @Override
  public void onCreate() {
    super.onCreate();

    if (!Sentry.isEnabled()) {
      Log.d(TAG, "Initializing Sentry");
      SentryAndroid.init(getApplicationContext(), options -> {
        options.setRelease("release-"+com.tavultesoft.kmapro.BuildConfig.VERSION_NAME);
        options.setEnvironment(com.tavultesoft.kmapro.BuildConfig.VERSION_ENVIRONMENT);
      });
    }
    if (BuildConfig.DEBUG) {
      KMManager.setDebugMode(true);
    }
    KMManager.addKeyboardEventListener(this);
    KMManager.initialize(getApplicationContext(), KeyboardType.KEYBOARD_TYPE_SYSTEM);
    interpreter = new KMHardwareKeyboardInterpreter(getApplicationContext(), KeyboardType.KEYBOARD_TYPE_SYSTEM);
    KMManager.setInputMethodService(this); // for HW interface
    KMManager.executeResourceUpdate(this);
  }

  @Override
  public void onDestroy() {
    inputView = null;
    KMManager.removeKeyboardEventListener(this);
    interpreter = null; // Throw it away, since we're losing our application's context.
    KMManager.onDestroy();
    super.onDestroy();
  }

  /**
   * This is the point where you can do all of your UI initialization. It
   * is called after creation and any configuration change.
   */
  @Override
  public void onInitializeInterface() {
    super.onInitializeInterface();
  }

  /**
   * Called by the framework when your view for creating input needs to
   * be generated. This will be called the first time your input method
   * is displayed, and every time it needs to be re-created such as due to
   * a configuration change.
   */
  @Override
  public View onCreateInputView() {
    if (inputView == null) {
      inputView = KMManager.createInputView(this);
    }

    ViewGroup parent = (ViewGroup) inputView.getParent();
    if (parent != null)
      parent.removeView(inputView);

    return inputView;
  }

  /**
   * Deal with the editor reporting movement of its cursor.
   */
  @Override
  public void onUpdateSelection(int oldSelStart, int oldSelEnd, int newSelStart, int newSelEnd, int candidatesStart, int candidatesEnd) {
    super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd);
    KMManager.updateSelectionRange(KMManager.KeyboardType.KEYBOARD_TYPE_SYSTEM, newSelStart, newSelEnd);
  }

  /**
   * This is the main point where we do our initialization of the input method
   * to begin operating on an application.  At this point we have been
   * bound to the client, and are now receiving all of the detailed information
   * about the target of our edits.
   */
  @Override
  public void onStartInput(EditorInfo attribute, boolean restarting) {
    attribute.imeOptions |= EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_FULLSCREEN;
    super.onStartInput(attribute, restarting);
    KMManager.onStartInput(attribute, restarting);
    if (!KMManager.isKeyboardLoaded(KeyboardType.KEYBOARD_TYPE_SYSTEM)) {
      Log.d(TAG, "onStartInput(): System Keyboard not loaded!");
    }
    //KMManager.resetContext(KeyboardType.KEYBOARD_TYPE_SYSTEM);

    // Check if the input field is for numeric layer
    isNumericField = false;
    int inputType = attribute.inputType;
    if (((inputType & InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_NUMBER) ||
        ((inputType & InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_PHONE)) {
      isNumericField = true;
    }

    // Temporarily disable predictions if entering a hidden password field
    KMManager.setMayPredictOverride(inputType);
    if (KMManager.getMayPredictOverride()) {
      KMManager.setBannerOptions(false);
    } else if (KMManager.isKeyboardLoaded(KeyboardType.KEYBOARD_TYPE_SYSTEM)){
      // Check if predictions needs to be re-enabled per Settings preference
      Context appContext = getApplicationContext();
      Keyboard kbInfo = KMManager.getCurrentKeyboardInfo(appContext);
      if (kbInfo != null) {
        String langId = kbInfo.getLanguageID();
        SharedPreferences prefs = appContext.getSharedPreferences(appContext.getString(R.string.kma_prefs_name), Context.MODE_PRIVATE);
        boolean mayPredict = prefs.getBoolean(KMManager.getLanguagePredictionPreferenceKey(langId), true);
        KMManager.setBannerOptions(mayPredict);
      }
    }

    updateTextContext();
  }

  /**
   * Method to update and reset the system context. Also overrides to numeric layer as needed.
   * Assumption: KMManager.SystemKeyboardLoaded is true
   */
  private void updateTextContext() {
    Log.d(TAG, "updateContext()");
    InputConnection ic = getCurrentInputConnection();
    if (ic != null) {
      ExtractedText icText = ic.getExtractedText(new ExtractedTextRequest(), 0);
      if (icText != null) {
        boolean didUpdateText = KMManager.updateText(KeyboardType.KEYBOARD_TYPE_SYSTEM, icText.text.toString());
        int selStart = icText.startOffset + icText.selectionStart;
        int selEnd = icText.startOffset + icText.selectionEnd;
        boolean didUpdateSelection = KMManager.updateSelectionRange(KeyboardType.KEYBOARD_TYPE_SYSTEM, selStart, selEnd);
        if (didUpdateSelection) {
          KMManager.resetContext(KeyboardType.KEYBOARD_TYPE_SYSTEM);
          Log.d(TAG, "KMManager.resetContext(SYSTEM)");
        }
        if (!didUpdateText || !didUpdateSelection)
          exText = icText;
      }
    } else {
      Log.d(TAG, "InputConnection null");
    }

    if (isNumericField) {
      KMManager.setNumericLayer(KeyboardType.KEYBOARD_TYPE_SYSTEM);
    }

  }

  @Override
  public void onStartInputView(EditorInfo attribute, boolean restarting) {
    super.onStartInputView(attribute, restarting);
  }

  @Override
  public void onUpdateExtractingVisibility(EditorInfo ei) {
    super.onUpdateExtractingVisibility(ei);
  }

  @Override
  public void onConfigurationChanged(Configuration newConfig) {
    super.onConfigurationChanged(newConfig);
    KMManager.onConfigurationChanged(newConfig);
  }

  @Override
  public void onConfigureWindow(Window win, boolean isFullscreen, boolean isCandidatesOnly) {
    super.onConfigureWindow(win, isFullscreen, isCandidatesOnly);

    // We don't currently use isFullscreen or isCandidatesOnly; we always want to MATCH_PARENT,
    // unlike the default for height which is WRAP_CONTENT. We then adjust the touchable area
    // in `onCalculateInsets`
    win.setLayout(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
  }

  @Override
  public void onComputeInsets(InputMethodService.Insets outInsets) {
    super.onComputeInsets(outInsets);

    // We should extend the touchable region so that Keyman sub keys menu can receive touch events outside the keyboard frame
    WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    Point size = new Point(0, 0);
    wm.getDefaultDisplay().getSize(size);

    int inputViewHeight = 0;
    if (inputView != null)
      inputViewHeight = inputView.getHeight();

    int bannerHeight = KMManager.getBannerHeight(this);
    int kbHeight = KMManager.getKeyboardHeight(this);
    outInsets.contentTopInsets = inputViewHeight - bannerHeight - kbHeight;
    outInsets.visibleTopInsets = outInsets.contentTopInsets;
    outInsets.touchableInsets = InputMethodService.Insets.TOUCHABLE_INSETS_REGION;
    outInsets.touchableRegion.set(0, outInsets.contentTopInsets, size.x, size.y);
  }

  @Override
  public void onKeyboardLoaded(KeyboardType keyboardType) {
    if (keyboardType == KeyboardType.KEYBOARD_TYPE_SYSTEM) {
      String str = (exText != null) ? exText.text.toString() : "";
      Log.d(TAG, "onKeyboardLoaded(). exText: " + str);
      //if (exText != null)
        //exText = null;

      updateTextContext();
    }
  }

  @Override
  public void onKeyboardChanged(String newKeyboard) {
    // Do nothing
  }

  @Override
  public void onKeyboardShown() {
    // Do nothing
  }

  @Override
  public void onKeyboardDismissed() {
    // Do nothing
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (event.getAction() == KeyEvent.ACTION_DOWN) {
      switch (keyCode) {
        case KeyEvent.KEYCODE_BACK:
          // Dismiss the keyboard if currently shown
          if (isInputViewShown()) {
            KMManager.hideSystemKeyboard();
            return true;
          }
          break;
      }
    }

    return interpreter.onKeyDown(keyCode, event);  // if false, will revert to default handling.
  }

  @Override
  public boolean onKeyUp(int keyCode, KeyEvent event) {
    return interpreter.onKeyUp(keyCode, event);
  }

  @Override
  public boolean onKeyMultiple(int keyCode, int count, KeyEvent event) {
    return interpreter.onKeyMultiple(keyCode, count, event);
  }

  @Override
  public boolean onKeyLongPress(int keyCode, KeyEvent event) {
    return interpreter.onKeyLongPress(keyCode, event);
  }
}