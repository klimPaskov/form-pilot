package dev.formpilot.helper;

import android.accessibilityservice.AccessibilityService;
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
    private final Set<String> handled = new HashSet<>();

    private WindowManager windows;
    private View button;
    private GradientDrawable dot;
    private volatile boolean busy;
    private volatile boolean cancel;

    @Override
    protected void onServiceConnected() {
        windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        addButton();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Nothing is read in the background; the tree is fetched only when the button is used.
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
                show(RED, "Form Pilot error: " + t.getMessage());
            } finally {
                busy = false;
            }
        });
    }

    private void run(Claude claude, boolean wholePage) {
        int filled = 0, failed = 0;
        String lastMessage = null;
        boolean low = false;
        for (int n = 0; n < (wholePage ? MAX_PER_RUN : 1) && !cancel; n++) {
            Question q = nextQuestion(wholePage);
            if (q == null) break;
            handled.add(q.key());
            try {
                Claude.Answer a = claude.ask(q, q.hasImage ? screenshot(q.bounds) : null);
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
            if (q.onScreen()) return q;
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
            AccessibilityNodeInfo node = q.nodes.get(0);
            node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, a.text);
            return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
        boolean any = false;
        for (int i = 0; i < q.nodes.size(); i++) {
            boolean want = a.choices.contains(i + 1);
            if (q.kind == Question.Kind.SINGLE && want && any) continue; // a single choice takes only the first
            AccessibilityNodeInfo node = q.nodes.get(i);
            node.refresh();
            if (node.isChecked() == want) {
                any |= want;
                continue;
            }
            // Radios only need the chosen one tapped; checkboxes are set to exactly the chosen set.
            if (want || q.kind == Question.Kind.MULTI) {
                boolean ok = click(node);
                any |= want && ok;
                pause(150);
            }
        }
        return any;
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

    /** For diagnosis over adb: `adb shell am broadcast` is not needed - see MainActivity's "Test read" button. */
    String describeScreen() {
        return ScreenReader.dump(getRootInActiveWindow());
    }
}
