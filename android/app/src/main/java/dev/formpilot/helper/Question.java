package dev.formpilot.helper;

import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;

/** One question read from the screen, with the nodes needed to answer it. */
final class Question {
    enum Kind { SINGLE, MULTI, TEXT }

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
        for (AccessibilityNodeInfo n : nodes) if (n.isChecked()) return true;
        return false;
    }

    boolean onScreen() {
        for (AccessibilityNodeInfo n : nodes) if (n.isVisibleToUser()) return true;
        return false;
    }

    /** Stable enough to remember "already handled" between taps on the same page. */
    String key() {
        return kind + "|" + prompt + "|" + options;
    }
}
