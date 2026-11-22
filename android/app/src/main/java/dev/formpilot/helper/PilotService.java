package dev.formpilot.helper;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The helper itself: a small floating button over the browser. A tap answers the question on
 * screen; a long press answers every unanswered question on the page. It reads the screen only
 * when the button is used, and it never presses buttons on the page, so it cannot submit anything.
 */
public class PilotService extends AccessibilityService {
    private static final String TAG = "FormPilot";
    private static final int GREY = 0xFF8A8F98, BLUE = 0xFF1A73E8, GREEN = 0xFF2E9E5B, AMBER = 0xFFD9930D, RED = 0xFFD64545;
    private static final int MAX_PER_RUN = 40;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** Questions answered or given up on, so the next tap moves on. Cleared when the page changes. */
    private final Set<String> handled = java.util.Collections.synchronizedSet(new HashSet<String>());

    private WindowManager windows;
    private View button;
    private GradientDrawable dot;
    private volatile boolean busy;
    /** How often auto mode has tried each question, so a question that keeps failing is not retried forever. */
    private final java.util.Map<String, Integer> autoTries = new java.util.concurrent.ConcurrentHashMap<>();
    private final Runnable autoCheck = () -> worker.execute(this::autoAnswer);
    private volatile boolean cancel;

    @Override
    protected void onServiceConnected() {
        windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        addButton();
        // Debug builds only: `adb shell am broadcast -a dev.formpilot.helper.DUMP -p dev.formpilot.helper`
        // writes what the reader sees to logcat, for diagnosing a page over USB.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            android.content.BroadcastReceiver dump = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(android.content.Context context, Intent intent) {
                    // Written to the app's private files (some phones suppress app logs):
                    // adb shell run-as dev.formpilot.helper cat files/dump.txt
                    // -a ...DUMP writes what the reader sees; --es do tap|hold also runs the helper first.
                    String act = intent.getStringExtra("do");
                    if (act != null) activate("hold".equals(act));
                    else note("dump.txt", describeScreen(), false);
                }
            };
            android.content.IntentFilter filter = new android.content.IntentFilter("dev.formpilot.helper.DUMP");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) registerReceiver(dump, filter, RECEIVER_EXPORTED);
            else registerReceiver(dump, filter);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // The page is read only when the button is used - or, in auto mode, when the browser shows
        // new content on Socrative. Events from every other app are ignored here.
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;
        if (event.getPackageName() == null || !event.getPackageName().toString().contains("chrome")) return;
        // A new window or page means earlier "skipped" notes no longer apply.
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && !busy) handled.clear();
        main.removeCallbacks(autoCheck);
        main.postDelayed(autoCheck, 900); // let the new question finish rendering
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        if (button != null) windows.removeView(button);
        worker.shutdownNow();
        super.onDestroy();
    }

    // ---- floating button ---------------------------------------------------------------------------

    private void addButton() {
        final int size = dp(46);
        dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(BLUE);
        button = new View(this);
        button.setBackground(dot);
        button.setAlpha(0.6f);

        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = getResources().getDisplayMetrics().widthPixels - size - dp(12);
        lp.y = getResources().getDisplayMetrics().heightPixels / 2;

        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        final Runnable longPress = () -> {
            button.setTag("long");
            activate(true);
        };
        button.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean dragging;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX();
                        downY = e.getRawY();
                        startX = lp.x;
                        startY = lp.y;
                        dragging = false;
                        v.setTag(null);
                        main.postDelayed(longPress, 600);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        if (!dragging && Math.hypot(e.getRawX() - downX, e.getRawY() - downY) > slop) {
                            dragging = true;
                            main.removeCallbacks(longPress);
                        }
                        if (dragging) {
                            lp.x = startX + (int) (e.getRawX() - downX);
                            lp.y = startY + (int) (e.getRawY() - downY);
                            windows.updateViewLayout(v, lp);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        main.removeCallbacks(longPress);
                        if (!dragging && v.getTag() == null) activate(false);
                        return true;
                    default:
                        main.removeCallbacks(longPress);
                        return true;
                }
            }
        });
        windows.addView(button, lp);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void show(final int color, final String message) {
        main.post(() -> {
            dot.setColor(color);
            if (message != null) Toast.makeText(PilotService.this, message, Toast.LENGTH_LONG).show();
            if (color != GREY) main.postDelayed(() -> { if (!busy) dot.setColor(BLUE); }, 2500);
        });
    }

    // ---- answering -----------------------------------------------------------------------------------

    /** A tap while a run is in progress stops it; otherwise it starts one. */
    private void activate(final boolean wholePage) {
        if (busy) {
            cancel = true;
            return;
        }
        final Prefs prefs = new Prefs(this);
        if (prefs.apiKey().isEmpty()) {
            show(RED, "Open Form Pilot and enter your API key first");
            return;
        }
        busy = true;
        cancel = false;
        show(GREY, null);
        worker.execute(() -> {
            try {
                run(new Claude(prefs.apiKey(), prefs.model(), prefs.effort()), wholePage);
            } catch (Throwable t) {
                Log.e(TAG, "run failed", t);
                note("log.txt", "ERROR " + Log.getStackTraceString(t), true);
                show(RED, "Form Pilot error: " + t.getMessage());
            } finally {
                busy = false;
                note("log.txt", "DONE", true);
            }
        });
    }

    /**
     * Auto mode: if the browser is on Socrative and shows a question that has no answer yet,
     * answer it as a tap on the button would. Selecting only - Submit Answer is never pressed.
     */
    private void autoAnswer() {
        Prefs prefs = new Prefs(this);
        if (busy || !prefs.autoSocrative() || prefs.apiKey().isEmpty()) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || !onSocrative(root)) return;
        int height = getResources().getDisplayMetrics().heightPixels;
        Question next = null;
        for (Question q : ScreenReader.read(root)) {
            if (!q.answered() && !handled.contains(q.key()) && q.onScreen(height)) {
                next = q;
                break;
            }
        }
        if (next == null) return;
        Integer tries = autoTries.get(next.key());
        if (tries != null && tries >= 2) return;
        autoTries.put(next.key(), tries == null ? 1 : tries + 1);
        busy = true;
        cancel = false;
        show(GREY, null);
        try {
            run(new Claude(prefs.apiKey(), prefs.model(), prefs.effort()), false);
        } catch (Throwable t) {
            note("log.txt", "AUTO ERROR " + Log.getStackTraceString(t), true);
            show(RED, "Form Pilot error: " + t.getMessage());
        } finally {
            busy = false;
            note("log.txt", "DONE (auto)", true);
        }
    }

    /** The address bar of the browser shows which site is open. */
    private static boolean onSocrative(AccessibilityNodeInfo root) {
        String pkg = String.valueOf(root.getPackageName());
        for (AccessibilityNodeInfo bar : root.findAccessibilityNodeInfosByViewId(pkg + ":id/url_bar")) {
            CharSequence url = bar.getText();
            if (url != null && url.toString().contains("socrative.com")) return true;
        }
        return false;
    }

    private void run(Claude claude, boolean wholePage) {
        int filled = 0, failed = 0;
        String lastMessage = null;
        boolean low = false;
        for (int n = 0; n < (wholePage ? MAX_PER_RUN : 1) && !cancel; n++) {
            Question q = nextQuestion(wholePage);
            if (q == null) break;
            handled.add(q.key());
            note("log.txt", "Q " + q.kind + " | " + q.prompt + " | " + q.options, true);
            try {
                Claude.Answer a = claude.ask(q, q.hasImage ? screenshot(q.bounds) : null);
                note("log.txt", "A answerable=" + a.answerable + " conf=" + a.confidence + " choices=" + a.choices + " text=" + a.text, true);
                if (cancel) break;
                if (!a.answerable) {
                    lastMessage = "No answer for this question - skipped";
                    failed++;
                } else if (apply(q, a)) {
                    filled++;
                    low |= "low".equals(a.confidence);
                    lastMessage = "low".equals(a.confidence) ? "Low confidence - check this one" : null;
                } else {
                    failed++;
                    lastMessage = "Could not fill in the answer";
                }
            } catch (Claude.Failure f) {
                failed++;
                lastMessage = f.getMessage();
                note("log.txt", "FAIL " + f.getMessage(), true);
                if (f.fatal) break;
            }
        }
        if (filled == 0 && failed == 0) show(RED, "No unanswered question found on screen");
        else if (wholePage) show(failed > 0 ? AMBER : GREEN, "Filled " + filled + (failed > 0 ? ", " + failed + " not filled" : "") + ". Review, then submit yourself.");
        else show(failed > 0 ? RED : low ? AMBER : GREEN, lastMessage);
    }

    /** The first unanswered question on screen; in whole-page mode, anywhere on the page. */
    private Question nextQuestion(boolean anywhere) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        List<Question> all = ScreenReader.read(root);
        Question offScreen = null;
        for (Question q : all) {
            if (q.answered() || handled.contains(q.key())) continue;
            if (q.onScreen(getResources().getDisplayMetrics().heightPixels)) return q;
            if (offScreen == null) offScreen = q;
        }
        if (offScreen != null && (anywhere || all.size() > 0)) {
            // Bring it into view so the click lands and any screenshot shows it.
            offScreen.nodes.get(0).performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
            pause(400);
        }
        return offScreen;
    }

    private boolean apply(Question q, Claude.Answer a) {
        if (q.kind == Question.Kind.TEXT) {
            if (a.text.isEmpty()) return false;
            return setText(q.nodes.get(0), a.text);
        }
        if (q.kind == Question.Kind.DROPDOWN) {
            if (a.choices.isEmpty() || a.choices.get(0) < 1 || a.choices.get(0) > q.options.size()) return false;
            return chooseFromDropdown(q, q.options.get(a.choices.get(0) - 1));
        }
        boolean any = false;
        for (int i = 0; i < q.nodes.size(); i++) {
            boolean want = a.choices.contains(i + 1);
            if (q.kind == Question.Kind.SINGLE && want && any) continue; // a single choice takes only the first
            AccessibilityNodeInfo node = q.nodes.get(i);
            node.refresh();
            boolean on = Question.checked(node);
            if (on == want) {
                any |= want;
                continue;
            }
            // Radios only need the chosen one tapped; checkboxes are set to exactly the chosen set.
            if (want || q.kind == Question.Kind.MULTI) {
                boolean ok = press(node, want);
                note("log.txt", "press " + q.options.get(i) + " -> " + ok, true);
                any |= want && ok;
            }
        }
        return any;
    }

    /**
     * Selects (or clears) an option the way a finger would: scroll it into view and tap its centre.
     * Pages built from custom widgets (Google Forms, Socrative) ignore the accessibility "click"
     * action but respond to a real touch. The result is read back; the click action is only tried
     * if the touch visibly changed nothing.
     */
    private boolean press(AccessibilityNodeInfo node, boolean want) {
        if (tap(node)) {
            pause(350);
            node.refresh();
            if (Question.checked(node) == want) return true;
        }
        node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        pause(300);
        node.refresh();
        return Question.checked(node) == want;
    }

    private boolean tap(AccessibilityNodeInfo node) {
        Rect r = visibleBounds(node);
        if (r == null) {
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
            pause(500);
            node.refresh();
            r = visibleBounds(node);
            if (r == null) return false;
        }
        android.graphics.Path path = new android.graphics.Path();
        path.moveTo(r.exactCenterX(), r.exactCenterY());
        android.accessibilityservice.GestureDescription gesture = new android.accessibilityservice.GestureDescription.Builder()
                .addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 60))
                .build();
        final CountDownLatch done = new CountDownLatch(1);
        final boolean[] ok = {false};
        boolean sent = dispatchGesture(gesture, new GestureResultCallback() {
            @Override
            public void onCompleted(android.accessibilityservice.GestureDescription g) {
                ok[0] = true;
                done.countDown();
            }

            @Override
            public void onCancelled(android.accessibilityservice.GestureDescription g) {
                done.countDown();
            }
        }, main);
        if (!sent) return false;
        try {
            done.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return ok[0];
    }

    /** The node's rectangle if it is fully on screen and not under the floating button; otherwise null. */
    private Rect visibleBounds(AccessibilityNodeInfo node) {
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        int height = getResources().getDisplayMetrics().heightPixels;
        if (r.isEmpty() || r.height() < dp(8) || r.top < dp(60) || r.bottom > height - dp(60)) return null;
        return r;
    }

    /**
     * Opens the dropdown with a tap, then taps the wanted entry in the list that appears. The open
     * list repeats the entries, so the on-screen match that comes last in the page is the one to tap.
     */
    private boolean chooseFromDropdown(Question q, String label) {
        if (!tap(q.nodes.get(0))) return false;
        pause(800);
        AccessibilityNodeInfo target = null;
        for (Question now : ScreenReader.read(getRootInActiveWindow())) {
            if (now.kind != Question.Kind.DROPDOWN) continue;
            for (int i = 0; i < now.options.size(); i++) {
                if (now.options.get(i).equals(label) && visibleBounds(now.nodes.get(i)) != null) target = now.nodes.get(i);
            }
        }
        boolean ok = target != null && tap(target);
        note("log.txt", "dropdown " + label + " found=" + (target != null) + " tapped=" + ok, true);
        pause(500);
        return ok;
    }

    /**
     * Types into a web text field. The field is focused first (with the on-screen keyboard held back),
     * then the text is set directly; if the page ignores that, it is pasted instead. Either way the
     * result is read back, so a field that did not take the text is reported as not filled.
     */
    private boolean setText(AccessibilityNodeInfo node, String text) {
        SoftKeyboardController keyboard = getSoftKeyboardController();
        keyboard.setShowMode(SHOW_MODE_HIDDEN);
        try {
            boolean focused = node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            boolean clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            pause(300);
            node.refresh();
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            boolean set = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            pause(300);
            node.refresh();
            boolean landed = holds(node, text);
            boolean pasted = false;
            // Paste only into a field that is still empty: pasting on top of partial text corrupts it.
            CharSequence after = node.getText();
            if (!landed && (after == null || after.length() == 0 || node.isShowingHintText())) {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("answer", text));
                pasted = node.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                pause(300);
                node.refresh();
                landed = holds(node, text);
            }
            note("log.txt", "setText focused=" + focused + " clicked=" + clicked + " set=" + set + " pasted=" + pasted
                    + " landed=" + landed + " now=" + node.getText(), true);
            return landed;
        } finally {
            keyboard.setShowMode(SHOW_MODE_AUTO);
        }
    }

    private static boolean holds(AccessibilityNodeInfo node, String text) {
        CharSequence now = node.getText();
        return now != null && !node.isShowingHintText() && now.toString().contains(text.substring(0, Math.min(text.length(), 20)));
    }

    /** Clicks the node, or the nearest clickable ancestor (the visible row around a radio button). */
    private static boolean click(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo n = node;
        for (int up = 0; n != null && up < 4; up++, n = n.getParent()) {
            if (n.isClickable() && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    // ---- screenshot for questions with pictures (Android 11+) ---------------------------------------

    private byte[] screenshot(final Rect area) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        final byte[][] out = new byte[1][];
        final CountDownLatch done = new CountDownLatch(1);
        takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult result) {
                try {
                    Bitmap hw = Bitmap.wrapHardwareBuffer(result.getHardwareBuffer(), result.getColorSpace());
                    Bitmap bmp = hw.copy(Bitmap.Config.ARGB_8888, false);
                    result.getHardwareBuffer().close();
                    Rect r = new Rect(area);
                    r.inset(-dp(8), -dp(8));
                    if (!r.intersect(0, 0, bmp.getWidth(), bmp.getHeight()) || r.width() < 50 || r.height() < 50) {
                        r.set(0, 0, bmp.getWidth(), bmp.getHeight());
                    }
                    Bitmap crop = Bitmap.createBitmap(bmp, r.left, r.top, r.width(), r.height());
                    ByteArrayOutputStream os = new ByteArrayOutputStream();
                    crop.compress(Bitmap.CompressFormat.JPEG, 80, os);
                    out[0] = os.toByteArray();
                } catch (Throwable t) {
                    Log.w(TAG, "screenshot failed", t);
                } finally {
                    done.countDown();
                }
            }

            @Override
            public void onFailure(int errorCode) {
                Log.w(TAG, "screenshot error " + errorCode);
                done.countDown();
            }
        });
        try {
            done.await(4, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return out[0];
    }

    String describeScreen() {
        return ScreenReader.dump(getRootInActiveWindow(), getResources().getDisplayMetrics().heightPixels);
    }

    /** Debug builds only: keeps a small private trace of what happened, readable over adb with run-as. */
    private void note(String file, String text, boolean append) {
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) return;
        try (java.io.FileOutputStream out = openFileOutput(file, append ? MODE_APPEND : MODE_PRIVATE)) {
            out.write((text + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (java.io.IOException e) {
            Log.w(TAG, "note failed", e);
        }
    }
}
