package dev.formpilot.helper;

import android.graphics.Rect;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Turns the accessibility tree of the page shown in the browser into questions.
 *
 * The page is flattened into reading order (text, headings, images, controls). A run of radio
 * buttons or checkboxes is one question whose text is whatever was read since the previous
 * question; a text field is a question on its own.
 */
final class ScreenReader {
    private ScreenReader() {}

    private enum Type { TEXT, HEADING, IMAGE, RADIO, CHECK, EDIT, OTHER_CONTROL }

    private static final class Item {
        Type type;
        String text = "";
        AccessibilityNodeInfo node;
        /** The radiogroup a radio belongs to (rows of a grid are separate groups). */
        AccessibilityNodeInfo group;
    }

    private static final Pattern PERSONAL = Pattern.compile(
            "^(\\d+[.)]\\s*)?(your |full |first |last |student )?((name|surname|id( number)?|class|group|date)\\s*[:*]?$|(e-?mail|phone)\\b).*",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final int MAX_PROMPT = 1500;

    static List<Question> read(AccessibilityNodeInfo root) {
        List<Question> out = new ArrayList<>();
        if (root == null) return out;
        AccessibilityNodeInfo web = findWebView(root, 0);
        List<Item> items = new ArrayList<>();
        flatten(web != null ? web : root, null, items, 0);

        StringBuilder prompt = new StringBuilder();
        Rect promptBounds = new Rect();
        boolean hasImage = false;
        boolean consumed = false; // the buffered text already belongs to an emitted question

        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            switch (it.type) {
                case HEADING:
                case TEXT:
                    if (consumed || it.type == Type.HEADING) {
                        prompt.setLength(0);
                        promptBounds.setEmpty();
                        hasImage = false;
                        consumed = false;
                    }
                    if (prompt.length() < MAX_PROMPT) prompt.append(it.text).append(' ');
                    unionBounds(promptBounds, it.node);
                    break;
                case IMAGE:
                    if (consumed) {
                        prompt.setLength(0);
                        promptBounds.setEmpty();
                        consumed = false;
                        hasImage = false;
                    }
                    hasImage = true;
                    unionBounds(promptBounds, it.node);
                    break;
                case RADIO:
                case CHECK: {
                    Question q = new Question();
                    q.kind = it.type == Type.RADIO ? Question.Kind.SINGLE : Question.Kind.MULTI;
                    q.bounds.set(promptBounds);
                    int j = i;
                    while (j < items.size()) {
                        Item o = items.get(j);
                        if (o.type == it.type && sameGroup(it, o)) {
                            q.nodes.add(o.node);
                            q.options.add(o.text);
                            unionBounds(q.bounds, o.node);
                            j++;
                        } else if ((o.type == Type.TEXT || o.type == Type.IMAGE) && nextIsOption(items, j, it)) {
                            // Text between two options is the visible label of the option before it.
                            int last = q.options.size() - 1;
                            if (o.type == Type.TEXT && last >= 0 && q.options.get(last).isEmpty()) q.options.set(last, o.text);
                            if (o.type == Type.IMAGE) q.hasImage = true;
                            j++;
                        } else break;
                    }
                    // Trailing label of the final option.
                    int last = q.options.size() - 1;
                    if (j < items.size() && items.get(j).type == Type.TEXT && q.options.get(last).isEmpty()) {
                        q.options.set(last, items.get(j).text);
                        j++;
                    }
                    i = j - 1;
                    String row = it.group != null ? label(it.group) : "";
                    q.prompt = clean(prompt + (row.isEmpty() ? "" : " - " + row));
                    q.hasImage |= hasImage;
                    consumed = true;
                    if (q.options.size() >= 2 && usable(q)) out.add(q);
                    break;
                }
                case EDIT: {
                    Question q = new Question();
                    q.kind = Question.Kind.TEXT;
                    q.nodes.add(it.node);
                    q.prompt = clean(prompt.length() > 0 ? prompt.toString() : it.text);
                    q.hasImage = hasImage;
                    q.bounds.set(promptBounds);
                    unionBounds(q.bounds, it.node);
                    consumed = true;
                    if (usable(q)) out.add(q);
                    break;
                }
                default:
                    // A button or other control ends whatever was being collected.
                    consumed = true;
            }
        }
        return out;
    }

    private static boolean usable(Question q) {
        return q.prompt.length() >= 3 && !PERSONAL.matcher(q.prompt).matches();
    }

    private static boolean sameGroup(Item a, Item b) {
        return a.group == null || b.group == null || a.group.equals(b.group);
    }

    private static boolean nextIsOption(List<Item> items, int from, Item first) {
        for (int k = from + 1; k < items.size() && k <= from + 3; k++) {
            Item n = items.get(k);
            if (n.type == first.type) return sameGroup(first, n);
            if (n.type != Type.TEXT && n.type != Type.IMAGE) return false;
        }
        return false;
    }

    private static AccessibilityNodeInfo findWebView(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 30) return null;
        if ("android.webkit.WebView".contentEquals(str(n.getClassName())) && n.getChildCount() > 0) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo hit = findWebView(n.getChild(i), depth + 1);
            if (hit != null) return hit;
        }
        return null;
    }

    private static void flatten(AccessibilityNodeInfo n, AccessibilityNodeInfo group, List<Item> out, int depth) {
        if (n == null || depth > 60 || out.size() > 4000) return;
        String cls = str(n.getClassName());
        String role = role(n);
        if (role.equals("radioGroup")) group = n;

        Type control = null;
        if (cls.endsWith("RadioButton") || role.equals("radioButton")) control = Type.RADIO;
        else if (cls.endsWith("CheckBox") || role.equals("checkBox") || role.equals("switch")) control = Type.CHECK;
        else if (cls.endsWith("EditText") || n.isEditable()) control = Type.EDIT;
        else if (cls.endsWith("Spinner") || cls.endsWith("Button") || role.equals("button") || role.equals("link")) control = Type.OTHER_CONTROL;

        if (control != null) {
            if (!n.isEnabled()) return;
            Item it = new Item();
            it.type = control;
            it.node = n;
            it.group = group;
            it.text = label(n);
            out.add(it);
            return; // a control's own text is its label, not page text
        }
        if (cls.endsWith("Image") || cls.endsWith("ImageView")) {
            Rect r = new Rect();
            n.getBoundsInScreen(r);
            if (r.width() > 80 && r.height() > 80) {
                Item it = new Item();
                it.type = Type.IMAGE;
                it.node = n;
                out.add(it);
            }
            return;
        }
        if (n.getChildCount() == 0) {
            String text = clean(str(n.getText()).isEmpty() ? str(n.getContentDescription()) : str(n.getText()));
            if (!text.isEmpty()) {
                Item it = new Item();
                it.type = n.isHeading() ? Type.HEADING : Type.TEXT;
                it.node = n;
                it.text = text;
                out.add(it);
            }
            return;
        }
        if (n.isHeading()) {
            Item it = new Item();
            it.type = Type.HEADING;
            it.node = n;
            it.text = label(n);
            if (!it.text.isEmpty()) out.add(it);
            return;
        }
        for (int i = 0; i < n.getChildCount(); i++) flatten(n.getChild(i), group, out, depth + 1);
    }

    /** Chrome reports the web role of each node in its extras. */
    private static String role(AccessibilityNodeInfo n) {
        Bundle extras = n.getExtras();
        CharSequence r = extras == null ? null : extras.getCharSequence("AccessibilityNodeInfo.chromeRole");
        return r == null ? "" : r.toString();
    }

    /** A node's own text, or failing that the text of everything inside it. */
    static String label(AccessibilityNodeInfo n) {
        String own = clean(str(n.getText()).isEmpty() ? str(n.getContentDescription()) : str(n.getText()));
        if (!own.isEmpty() && !n.isShowingHintText()) return own;
        StringBuilder sb = new StringBuilder();
        collectText(n, sb, 0);
        String inner = clean(sb.toString());
        return inner.isEmpty() ? own : inner;
    }

    private static void collectText(AccessibilityNodeInfo n, StringBuilder sb, int depth) {
        if (n == null || depth > 8 || sb.length() > 400) return;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c == null) continue;
            String t = str(c.getText()).isEmpty() ? str(c.getContentDescription()) : str(c.getText());
            if (!t.isEmpty()) sb.append(t).append(' ');
            else collectText(c, sb, depth + 1);
        }
    }

    private static void unionBounds(Rect into, AccessibilityNodeInfo n) {
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        if (!r.isEmpty()) into.union(r);
    }

    private static String str(CharSequence s) {
        return s == null ? "" : s.toString();
    }

    static String clean(String s) {
        return s == null ? "" : s.replaceAll("\\s+", " ").trim();
    }

    /** Plain-text dump of what the reader sees, for diagnosing a page it gets wrong. */
    static String dump(AccessibilityNodeInfo root) {
        StringBuilder sb = new StringBuilder();
        for (Question q : read(root)) {
            sb.append(q.kind).append(q.answered() ? " [answered] " : " ").append(q.prompt).append('\n');
            for (String o : q.options) sb.append("   - ").append(o).append('\n');
        }
        return sb.length() == 0 ? "(no questions found)" : sb.toString();
    }
}
