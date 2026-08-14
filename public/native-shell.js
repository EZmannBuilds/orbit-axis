// Orbit Axis :: native container behavior (Update 1.1.1).
//
// Everything in this file is a NO-OP in a browser. It is loaded unconditionally
// by index.html — guarding the import itself would mean the web build and the
// native build load different files, and two entry points is exactly how the
// two versions start to drift.
//
// It fixes only what a WebView gets wrong that a browser does not:
//
//   1. Safe areas — the notch and the home indicator, which a browser has no
//      concept of and a phone very much does.
//   2. External links — a plain navigation inside the app's WebView replaces
//      the app with a web page and leaves no way back.
//   3. Hardware back — Android's back button, and iOS's edge swipe, must not
//      exit the app from a nested view.
//   4. Resume — a phone suspends the app; a browser tab does not.
//
// What it deliberately does NOT do: request any permission. No camera,
// microphone, contacts, location, tracking, photo library, or notifications.
// The foundation needs none of them, and a permission prompt a user cannot
// explain is a permission that should not be asked for.

import { isNativeApp, openExternal, externalPageUrl } from "./platform.js";

/** Paths served as their own documents rather than by the app shell. */
const STANDALONE_PAGES = ["/privacy", "/terms", "/support", "/source", "/account-deletion"];

function plugin(name) {
  return globalThis.Capacitor?.Plugins?.[name];
}

/**
 * Mark the document so CSS can target the native container.
 *
 * A class rather than a media query: "is this an app" is not something CSS can
 * detect, and the alternative is duplicating layout rules per platform.
 */
function markPlatform() {
  const root = document.documentElement;
  root.classList.toggle("is-native-app", isNativeApp());
  root.classList.toggle("is-web-app", !isNativeApp());
}

/**
 * Send links that leave the shell to the system browser.
 *
 * One delegated listener rather than per-link wiring, so a link added anywhere
 * later inherits the behavior without anyone remembering to.
 *
 * In-app hash navigation (#home, #me) is untouched — that is the router.
 */
function interceptExternalLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link) return;

    const href = link.getAttribute("href") || "";
    // The router's own links, and anything explicitly opted out.
    if (href.startsWith("#") || link.dataset.nativeInApp === "true") return;

    const isAbsolute = /^https?:\/\//i.test(href);
    const isStandalone = STANDALONE_PAGES.includes(href.replace(/\/+$/, "") || "/");
    if (!isAbsolute && !isStandalone) return;

    // A standalone page reached by path relies on a rewrite that only the web
    // server performs; inside the bundle it would 404. Resolve it against the
    // configured origin and hand it to the system browser, which is where a
    // legal document belongs anyway.
    event.preventDefault();
    const url = isAbsolute ? href : externalPageUrl(href);
    void openExternal(url);
  }, true);
}

/**
 * Keep the hardware back gesture inside the app.
 *
 * Without this, back from a nested workspace exits Orbit entirely, which reads
 * as a crash. With it, back unwinds the router and only exits from the root.
 */
async function wireBackButton() {
  const app = plugin("App");
  if (!app?.addListener) return;
  await app.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && globalThis.history.length > 1) {
      globalThis.history.back();
      return;
    }
    const atRoot = !globalThis.location.hash || globalThis.location.hash === "#home";
    if (atRoot) {
      app.exitApp?.();
      return;
    }
    globalThis.location.hash = "home";
  });
}

/**
 * Re-check the session when the app returns from the background.
 *
 * A phone can suspend Orbit for a day. A token that was valid when the app was
 * backgrounded may not be when it returns, and the honest moment to discover
 * that is on resume rather than when someone taps something and it fails.
 *
 * Dispatches an event rather than calling into the application directly, so
 * this file stays a container concern and app.js keeps owning session logic.
 */
async function wireResume() {
  const app = plugin("App");
  if (!app?.addListener) return;
  await app.addListener("appStateChange", ({ isActive }) => {
    if (isActive) document.dispatchEvent(new CustomEvent("orbit:resumed"));
  });
}

/** Match the status bar to Orbit's own surface rather than a default white. */
async function wireStatusBar() {
  const statusBar = plugin("StatusBar");
  if (!statusBar?.setStyle) return;
  try {
    // "DARK" is Capacitor's name for LIGHT CONTENT on a dark background, which
    // is what Orbit's default theme needs. The naming is genuinely backwards.
    await statusBar.setStyle({ style: "DARK" });
    await statusBar.setOverlaysWebView?.({ overlay: false });
  } catch {
    // A status bar that keeps its default appearance is cosmetic, not a
    // failure worth interrupting startup for.
  }
}

/**
 * Publish the keyboard height as a CSS variable.
 *
 * The WebView resizes for the keyboard, but fixed elements — the bottom
 * navigation in particular — need to know about it too, or they sit under it.
 */
async function wireKeyboard() {
  const keyboard = plugin("Keyboard");
  if (!keyboard?.addListener) return;
  const set = (px) => document.documentElement.style.setProperty("--orbit-keyboard-inset", `${px}px`);
  await keyboard.addListener("keyboardWillShow", (info) => {
    set(Number(info?.keyboardHeight) || 0);
    document.documentElement.classList.add("keyboard-open");
  });
  await keyboard.addListener("keyboardWillHide", () => {
    set(0);
    document.documentElement.classList.remove("keyboard-open");
  });
}

export async function initNativeShell() {
  markPlatform();
  interceptExternalLinks();
  if (!isNativeApp()) return;
  await Promise.all([wireBackButton(), wireResume(), wireStatusBar(), wireKeyboard()]);
}

// Self-initialising: index.html loads this as a module, and there is exactly
// one correct time to run it.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void initNativeShell(); });
} else {
  void initNativeShell();
}
