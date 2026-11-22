package dev.formpilot.helper;

import android.content.Context;
import android.content.SharedPreferences;

/** Settings, stored privately on the device. */
final class Prefs {
    static final String[] MODELS = {"claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-2"};
    static final String[] EFFORTS = {"low", "medium", "high"};

    private final SharedPreferences sp;

    Prefs(Context context) {
        sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    String apiKey() {
        return sp.getString("apiKey", "").trim();
    }

    String model() {
        return sp.getString("model", MODELS[0]);
    }

    String effort() {
        return sp.getString("effort", "medium");
    }

    /** Select the answer automatically when Socrative shows a new question. */
    boolean autoSocrative() {
        return sp.getBoolean("autoSocrative", true);
    }

    void set(String key, boolean value) {
        sp.edit().putBoolean(key, value).apply();
    }

    void set(String key, String value) {
        sp.edit().putString(key, value).apply();
    }
}
