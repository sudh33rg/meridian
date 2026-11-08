// Runs before first paint so there is no flash of the wrong theme.
// External file (not inline) because the CSP is script-src 'self'.
(function () {
  try {
    var raw = localStorage.getItem("meridian.appearance");
    var a = raw ? JSON.parse(raw) : {};
    var mode = a.mode || "system";
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = mode === "system" ? (dark ? "dark" : "light") : mode;
    var r = document.documentElement;
    r.setAttribute("data-theme", theme);
    r.setAttribute("data-accent", a.accent || "blue");
    r.setAttribute("data-density", a.density || "comfortable");
    if (a.motion) r.setAttribute("data-motion", a.motion);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0d1117");
  } catch (e) {
    /* storage unavailable: CSS defaults apply */
  }
})();
