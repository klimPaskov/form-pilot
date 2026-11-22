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
 * buttons or checkboxes is one question; a text field is a question on its own. The question text
 * is the heading it sits under (with its description) plus whatever was read since the previous
 * question - which is how the rows of a grid each keep the grid's title.
 */
final class ScreenReader {
    private ScreenReader() {}

    private enum Type { TEXT, HEADING, IMAGE, RADIO, CHECK, EDIT, OPTION, STRUCTURED, OTHER_CONTROL }

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
        List<Item> items = items(root);

        // `context`: the current heading and the text under it, up to the first control.
        // `extra`: text read since the last question (a grid row's label, for example).
        StringBuilder context = new StringBuilder();
        StringBuilder extra = new StringBuilder();
        Rect bounds = new Rect();
        Rect imageBounds = new Rect();
        boolean underHeading = false;
        boolean contextOpen = true;
        boolean hasImage = false;
        // A date or time question is made of several linked parts (hours, minutes, AM/PM); filling
        // them one by one produces nonsense, so everything under that heading is left to the user.
        boolean leaveAlone = false;

        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            if (it.type == Type.HEADING) leaveAlone = false;
            else if (it.type == Type.STRUCTURED) leaveAlone = true;
            if (leaveAlone) continue;
            switch (it.type) {
                case HEADING:
                    context.setLength(0);
                    extra.setLength(0);
                    bounds.setEmpty();
                    underHeading = true;
                    contextOpen = true;
                    context.append(it.text.replaceAll("\\s*(Required question|\\*)\\s*$", "")).append(' ');
                    unionBounds(bounds, it.node);
                    break;
                case TEXT:
                    StringBuilder target = contextOpen ? context : extra;
                    if (target.length() < MAX_PROMPT) target.append(it.text).append(' ');
                    unionBounds(bounds, it.node);
                    break;
                case IMAGE:
                    // Kept apart from the text bounds: the picture can come before its question's heading.
                    hasImage = true;
                    unionBounds(imageBounds, it.node);
                    break;
                case RADIO:
                case CHECK: {
                    Question q = new Question();
                    q.kind = it.type == Type.RADIO ? Question.Kind.SINGLE : Question.Kind.MULTI;
                    q.bounds.set(bounds);
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
                    // Trailing visible label of the final option.
                    if (j < items.size() && items.get(j).type == Type.TEXT) {
                        int last = q.options.size() - 1;
                        String label = items.get(j).text;
                        if (q.options.get(last).isEmpty() || q.options.get(last).equals(label)) {
                            q.options.set(last, label);
                            j++;
                        }
                    }
                    // A text field straight after the options is the free-text "Other" answer: drop that
                    // option and the field, so the answer is always one of the real choices.
                    if (j < items.size() && items.get(j).type == Type.EDIT && q.options.size() > 2) {
                        q.options.remove(q.options.size() - 1);
                        q.nodes.remove(q.nodes.size() - 1);
                        j++;
                    }
                    i = j - 1;
                    q.prompt = prompt(context, extra);
                    q.hasImage |= hasImage;
                    if (hasImage) q.bounds.union(imageBounds);
                    hasImage = false;
                    imageBounds.setEmpty();
                    if (q.options.size() >= 2 && usable(q)) out.add(q);
                    contextOpen = false;
                    extra.setLength(0);
                    if (!underHeading) context.setLength(0);
                    break;
                }
                case OPTION: {
                    // The entries of a dropdown are all present in the page even while it is closed.
                    Question q = new Question();
                    q.kind = Question.Kind.DROPDOWN;
                    q.bounds.set(bounds);
                    int j = i;
                    while (j < items.size() && items.get(j).type == Type.OPTION && sameGroup(it, items.get(j))) {
                        q.nodes.add(items.get(j).node);
                        q.options.add(items.get(j).text);
                        j++;
                    }
                    i = j - 1;
                    q.prompt = prompt(context, extra);
                    q.hasImage = hasImage;
                    if (hasImage) q.bounds.union(imageBounds);
                    hasImage = false;
                    imageBounds.setEmpty();
                    if (q.options.size() >= 2 && usable(q)) out.add(q);
                    contextOpen = false;
                    extra.setLength(0);
                    if (!underHeading) context.setLength(0);
                    break;
                }
                case EDIT: {
                    Question q = new Question();
                    q.kind = Question.Kind.TEXT;
                    q.nodes.add(it.node);
                    q.prompt = prompt(context, extra);
                    if (q.prompt.isEmpty()) q.prompt = clean(it.text);
                    q.hasImage = hasImage;
                    q.bounds.set(bounds);
                    unionBounds(q.bounds, it.node);
                    if (usable(q)) out.add(q);
                    contextOpen = false;
                    extra.setLength(0);
                    if (!underHeading) context.setLength(0);
                    break;
                }
                default:
                    // A button, link or dropdown: whatever follows belongs to something else.
                    extra.setLength(0);
                    if (!underHeading) {
                        context.setLength(0);
                        contextOpen = true;
                    }
            }
        }
        return out;
    }

    private static String prompt(StringBuilder context, StringBuilder extra) {
        String c = clean(context.toString());
        String e = clean(extra.toString());
        if (c.isEmpty()) return e;
        return e.isEmpty() ? c : c + " - " + e;
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

    private static List<Item> items(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo web = findWebView(root, 0);
        List<Item> items = new ArrayList<>();
        flatten(web != null ? web : root, null, items, 0);
        return items;
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
        if (role.equals("radioGroup") || role.equals("listBox")) group = n;

        Type control = null;
        if (cls.endsWith("RadioButton") || role.equals("radioButton")) control = Type.RADIO;
        else if (cls.endsWith("CheckBox") || role.equals("checkBox") || role.equals("switch")) control = Type.CHECK;
        else if (role.equals("listBoxOption")) control = Type.OPTION;
        // Date and time pickers, and tiny numeric segments (hours / minutes), are not free-text answers.
        else if (cls.endsWith("EditText") || n.isEditable()) control = structured(n) ? Type.STRUCTURED : Type.EDIT;
        else if (cls.endsWith("Spinner") || cls.endsWith("Button") || role.equals("button") || role.equals("link")
                || role.equals("comboBoxSelect")) control = Type.OTHER_CONTROL;

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
        if (n.getChildCount() == 0 || n.isHeading()) {
            String text = n.getChildCount() == 0 ? ownText(n) : label(n);
            if (!text.isEmpty()) {
                Item it = new Item();
                it.type = n.isHeading() ? Type.HEADING : Type.TEXT;
                it.node = n;
                it.text = text;
                out.add(it);
            }
            return;
        }
        for (int i = 0; i < n.getChildCount(); i++) flatten(n.getChild(i), group, out, depth + 1);
    }

    private static boolean structured(AccessibilityNodeInfo n) {
        int cls = n.getInputType() & android.text.InputType.TYPE_MASK_CLASS;
        if (cls == android.text.InputType.TYPE_CLASS_DATETIME) return true;
        String role = role(n);
        if (role.contains("date") || role.contains("time") || role.equals("spinButton") || role.contains("ComboBox")) return true;
        boolean numeric = cls == android.text.InputType.TYPE_CLASS_NUMBER || cls == android.text.InputType.TYPE_CLASS_PHONE;
        return numeric && n.getMaxTextLength() > 0 && n.getMaxTextLength() <= 4;
    }

    /** Chrome reports the web role of each node in its extras. */
    private static String role(AccessibilityNodeInfo n) {
        Bundle extras = n.getExtras();
        CharSequence r = extras == null ? null : extras.getCharSequence("AccessibilityNodeInfo.chromeRole");
        return r == null ? "" : r.toString();
    }

    private static String ownText(AccessibilityNodeInfo n) {
        return clean(str(n.getText()).isEmpty() ? str(n.getContentDescription()) : str(n.getText()));
    }

    /** A node's own text, or failing that the text of everything inside it. */
    static String label(AccessibilityNodeInfo n) {
        String own = ownText(n);
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
    static String dump(AccessibilityNodeInfo root, int screenHeight) {
        if (root == null) return "(no active window)";
        StringBuilder sb = new StringBuilder();
        sb.append("window=").append(root.getPackageName()).append(" webview=").append(findWebView(root, 0) != null).append('\n');
        Rect r = new Rect();
        for (Item it : items(root)) {
            it.node.getBoundsInScreen(r);
            sb.append(it.type).append(' ')
                    .append(str(it.node.getClassName()).replaceAll(".*\\.", "")).append(" role=").append(role(it.node))
                    .append(Question.checked(it.node) ? " CHECKED" : "").append(" st=").append(it.node.getStateDescription())
                    .append(it.node.isEditable() ? " in=" + it.node.getInputType() + " max=" + it.node.getMaxTextLength() : "").append(it.node.isClickable() ? " clk" : "")
                    .append(it.group != null ? " grp" : "").append(" y=").append(r.top)
                    .append(" | ").append(it.text.length() > 70 ? it.text.substring(0, 70) : it.text).append('\n');
        }
        for (Item it : items(root)) {
            if (it.type == Type.CHECK) {
                sb.append("RAW ").append(it.node.toString()).append('\n');
                Bundle ex = it.node.getExtras();
                sb.append("EXTRAS");
                if (ex != null) for (String k : ex.keySet()) sb.append(' ').append(k).append('=').append(ex.get(k)).append(';');
                try {
                    sb.append(" getChecked=").append(AccessibilityNodeInfo.class.getMethod("getChecked").invoke(it.node));
                } catch (ReflectiveOperationException e) {
                    sb.append(" getChecked=n/a");
                }
                sb.append('\n');
                break;
            }
        }
        sb.append("---- questions ----\n");
        for (Question q : read(root)) {
            sb.append(q.kind).append(q.answered() ? " [answered]" : "").append(q.onScreen(screenHeight) ? " [on screen] " : " ")
                    .append(q.prompt).append('\n');
            for (int i = 0; i < q.options.size(); i++) {
                sb.append("   ").append(Question.checked(q.nodes.get(i)) ? "(x) " : "( ) ").append(q.options.get(i)).append('\n');
            }
            if (q.kind == Question.Kind.TEXT) sb.append("   = ").append(q.nodes.get(0).getText()).append('\n');
        }
        return sb.toString();
    }
}
