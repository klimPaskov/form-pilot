package dev.formpilot.helper;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;

/** Settings screen: switch the helper on, enter the API key, and choose how it behaves per site. */
public class MainActivity extends Activity {
    private static final int GREEN = 0xFF2E9E5B, RED = 0xFFD64545, BLUE = 0xFF1A73E8;

    private Prefs prefs;
    private TextView status;
    private TextView statusHint;
    private Button statusButton;
    private LinearLayout content;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(12), dp(18), dp(40));

        // ---- status: is the helper switched on, with one button to the right settings page ----
        LinearLayout card = card();
        status = text(card, "", 20, true);
        statusHint = text(card, "", 14, false);
        statusButton = new Button(this);
        statusButton.setOnClickListener(v -> openAccessibility());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        card.addView(statusButton, lp);

        // ---- Claude ----
        section("Claude");
        label("Anthropic API key");
        EditText key = new EditText(this);
        key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        key.setHint("sk-ant-...");
        key.setText(prefs.apiKey());
        // Keep the key masked. (setSingleLine() would silently replace the password masking.)
        key.setMaxLines(1);
        key.setTransformationMethod(android.text.method.PasswordTransformationMethod.getInstance());
        key.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { prefs.set("apiKey", s.toString()); }
        });
        content.addView(key);
        note("Stored only on this phone.");
        label("Model");
        content.addView(spinner(Prefs.MODELS, prefs.model(), value -> prefs.set("model", value)));
        label("Effort");
        content.addView(spinner(Prefs.EFFORTS, prefs.effort(), value -> prefs.set("effort", value)));
        note("Lower effort answers faster; higher thinks longer on hard questions.");

        // ---- Google Forms ----
        section("Google Forms");
        toggle("Answer the page automatically",
                "When a Google Form opens or moves to a new page, fill every unanswered question without touching the dot. Off: use the dot.",
                prefs.autoForms(), on -> prefs.set("autoForms", on));
        note("With the dot: tap for one question, hold until teal for the whole page, hold until purple (2 s) for every page of the form. "
                + "Date, time and file-upload questions are left to you.");

        // ---- Socrative ----
        section("Socrative");
        toggle("Answer each question automatically",
                "The answer is selected as each question appears. Submit Answer is still yours to press.",
                prefs.autoSocrative(), on -> prefs.set("autoSocrative", on));

        // ---- Floating dot ----
        section("Floating dot");
        toggle("Show the dot",
                "Hide it to keep the screen clear; the automatic modes above still work while it is hidden.",
                prefs.showDot(), on -> prefs.set("showDot", on));
        note("Drag the dot anywhere. Grey: working. Green: filled. Amber: low confidence, check it. Red: a problem. Tap it during a run to stop.");

        // ---- About ----
        section("What it does and does not do");
        note("Form Pilot never presses Submit. In whole-form mode the only page button it presses is Next.\n\n"
                + "It reads the screen only when you use the dot, or on a site where an automatic mode is switched on. "
                + "Only the question, its options and a screenshot of any picture in it are sent to the Anthropic API.\n\n"
                + "Claude can be wrong: an amber dot means low confidence.");

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setFitsSystemWindows(true);
        scroll.addView(content, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean on = enabled != null && enabled.contains(getPackageName() + "/");
        status.setText(on ? "Form Pilot is on" : "Form Pilot is off");
        status.setTextColor(on ? GREEN : RED);
        statusHint.setText(on
                ? "Open a form or quiz in Chrome. To switch it off, use the button below and turn Form Pilot off."
                : "Switch Form Pilot on under Accessibility. If the switch is greyed out: App info > three dots > Allow restricted settings.");
        statusButton.setText(on ? "Open Form Pilot's accessibility switch" : "Turn on in Accessibility settings");
    }

    /** Goes straight to this app's own accessibility page where the phone supports it, else to the list with it highlighted. */
    private void openAccessibility() {
        String component = new ComponentName(this, PilotService.class).flattenToString();
        try {
            Intent direct = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
            direct.putExtra(Intent.EXTRA_COMPONENT_NAME, component);
            startActivity(direct);
            return;
        } catch (Exception ignored) {
            // not available on this phone: fall through to the list
        }
        Intent list = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        Bundle args = new Bundle();
        args.putString(":settings:fragment_args_key", component);
        list.putExtra(":settings:fragment_args_key", component);
        list.putExtra(":settings:show_fragment_args", args);
        startActivity(list);
    }

    // ---- small view helpers ----------------------------------------------------------------------

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setColor(0x14808080);
        bg.setStroke(dp(1), 0x33808080);
        card.setBackground(bg);
        content.addView(card, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return card;
    }

    private TextView text(LinearLayout parent, String value, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        parent.addView(t);
        return t;
    }

    private void section(String title) {
        TextView t = text(content, title, 13, true);
        t.setTextColor(BLUE);
        t.setAllCaps(true);
        t.setLetterSpacing(0.06f);
        t.setPadding(0, dp(26), 0, dp(6));
    }

    private void label(String value) {
        TextView t = text(content, value, 15, false);
        t.setPadding(0, dp(10), 0, 0);
    }

    private void note(String value) {
        TextView t = text(content, value, 13, false);
        t.setAlpha(0.7f);
        t.setPadding(0, dp(4), 0, dp(4));
    }

    private interface OnToggle {
        void set(boolean on);
    }

    private void toggle(String title, String description, boolean on, final OnToggle onToggle) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        text(texts, title, 16, false);
        TextView d = text(texts, description, 13, false);
        d.setAlpha(0.7f);
        row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        final Switch sw = new Switch(this);
        sw.setChecked(on);
        sw.setOnCheckedChangeListener((button, checked) -> onToggle.set(checked));
        row.addView(sw);
        row.setOnClickListener(v -> sw.toggle());
        content.addView(row);
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
