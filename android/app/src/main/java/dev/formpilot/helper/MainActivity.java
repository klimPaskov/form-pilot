package dev.formpilot.helper;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

/** Setup screen: switch the helper on, and enter the API key once. */
public class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final Prefs prefs = new Prefs(this);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = text(root, "", 16);
        Button open = new Button(this);
        open.setText("Open accessibility settings");
        open.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(open);

        text(root, "\nAnthropic API key", 14);
        EditText key = new EditText(this);
        key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        key.setHint("sk-ant-...");
        key.setText(prefs.apiKey());
        key.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { prefs.set("apiKey", s.toString()); }
        });
        root.addView(key);

        text(root, "\nModel", 14);
        root.addView(spinner(Prefs.MODELS, prefs.model(), value -> prefs.set("model", value)));
        text(root, "\nEffort (lower is faster)", 14);
        root.addView(spinner(Prefs.EFFORTS, prefs.effort(), value -> prefs.set("effort", value)));

        text(root, "\nHow to use\n"
                + "1. Turn on Form Pilot under Accessibility (button above). On Android 13 or later, if the switch is greyed out: "
                + "open this app's App info, tap the three dots, and choose \"Allow restricted settings\".\n"
                + "2. A blue dot appears at the edge of the screen. Drag it wherever you like.\n"
                + "3. Open a form or quiz in Chrome. Tap the dot to answer the question on screen. "
                + "Hold it to answer every unanswered question on the page. Tap it during a run to stop.\n"
                + "4. The dot turns green when filled, amber for a low-confidence answer, red on a problem.\n\n"
                + "Form Pilot never presses Submit. It reads the screen only when you use the dot, and sends only the question to the Anthropic API.", 14);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean on = enabled != null && enabled.contains(getPackageName() + "/");
        status.setText(on ? "Form Pilot is ON" : "Form Pilot is OFF - turn it on under Accessibility");
    }

    private TextView text(LinearLayout parent, String value, int sp) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        parent.addView(t);
        return t;
    }

    private interface OnPick {
        void pick(String value);
    }

    private Spinner spinner(final String[] values, String current, final OnPick onPick) {
        Spinner s = new Spinner(this);
        s.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, values));
        for (int i = 0; i < values.length; i++) if (values[i].equals(current)) s.setSelection(i);
        s.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { onPick.pick(values[position]); }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
        return s;
    }
}
