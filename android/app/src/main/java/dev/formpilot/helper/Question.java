package dev.formpilot.helper;

import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;

/** One question read from the screen, with the nodes needed to answer it. */
final class Question {
    enum Kind { SINGLE, MULTI, TEXT, DROPDOWN }

    Kind kind;
    String prompt = "";
    /** Option labels, parallel to {@link #nodes} (choice questions). */
    final List<String> options = new ArrayList<>();
    /** Option nodes for a choice question; the single input node for a text question. */
    final List<AccessibilityNodeInfo> nodes = new ArrayList<>();
    /** The question contains a picture, so a screenshot should go with it. */
    boolean hasImage;
    /** On-screen area covering the question (for cropping the screenshot). */
    final Rect bounds = new Rect();

    boolean answered() {
        if (kind == Kind.TEXT) {
            AccessibilityNodeInfo n = nodes.get(0);
            CharSequence text = n.getText();
            return text != null && text.toString().trim().length() > 0 && !n.isShowingHintText();
        }
        // A dropdown is answered once something other than its first (placeholder) entry is selected.
        for (int i = kind == Kind.DROPDOWN ? 1 : 0; i < nodes.size(); i++) if (checked(nodes.get(i))) return true;
        return false;
    }

    /**
     * Whether a radio button or checkbox is selected. Android 16 reports this through the tri-state
     * getChecked(); the older isChecked() can stay false there, so both are consulted, along with
     * the spoken state ("checked" / "selected").
     */
    static boolean checked(AccessibilityNodeInfo n) {
        if (n.isChecked() || n.isSelected()) return true;
        try {
            Object state = AccessibilityNodeInfo.class.getMethod("getChecked").invoke(n);
            if (state instanceof Integer && (Integer) state == 1) return true;
        } catch (ReflectiveOperationException ignored) {
            // older Android: isChecked() above is the answer
        }
        CharSequence spoken = n.getStateDescription();
        return spoken != null && spoken.toString().toLowerCase().matches("(checked|selected|on|ticked)");
    }

    /** Chrome reports every node as visible, so "on screen" is decided from the node's position. */
    boolean onScreen(int screenHeight) {
        Rect r = new Rect();
        for (AccessibilityNodeInfo n : nodes) {
            n.getBoundsInScreen(r);
            if (!r.isEmpty() && r.top >= 0 && r.bottom <= screenHeight) return true;
        }
        return false;
    }

    /** Stable enough to remember "already handled" between taps on the same page. */
    String key() {
        return kind + "|" + prompt + "|" + options;
    }
}
