/**
 * Preview sandbox.
 *
 * Generated code is untrusted input: it came from a language model, driven by a
 * prompt anyone can type. It therefore runs in an iframe with a deliberately
 * restrictive sandbox — and note what is *absent*: `allow-same-origin`.
 * Combining `allow-scripts` with `allow-same-origin` on a same-origin document
 * lets the frame reach into the parent, read cookies, and rewrite the host page
 * — the sandbox would be decorative. Author scripts still get a full DOM; they
 * just get an opaque origin.
 *
 * The cost of an opaque origin is that `localStorage` throws, which would break
 * every generated app that tries to save anything. So a small runtime is
 * injected ahead of the author's code that (a) substitutes an in-memory storage
 * stand-in, and (b) reports crashes and console errors to the host so a broken
 * generation is visible instead of silently blank.
 */

export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";

export const PREVIEW_SOURCE = "molecule-preview";

const RUNTIME = `<script data-molecule-runtime>
(function () {
  var post = function (type, payload) {
    var msg = { __molecule: true, type: type };
    for (var k in payload) msg[k] = payload[k];
    try { parent.postMessage(msg, "*"); } catch (e) {}
  };

  // --- storage stand-in -----------------------------------------------------
  // In an opaque origin the localStorage getter itself throws, so probing is
  // the only way to know. The stand-in keeps the same API surface, which is all
  // a generated app relies on; it simply does not survive a reload.
  var probe = false;
  try { window.localStorage.getItem("__probe__"); } catch (e) { probe = true; }

  if (probe) {
    var makeStore = function () {
      var data = {};
      var store = {
        getItem: function (k) {
          k = String(k);
          return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
        },
        setItem: function (k, v) { data[String(k)] = String(v); },
        removeItem: function (k) { delete data[String(k)]; },
        clear: function () { data = {}; },
        key: function (i) { return Object.keys(data)[i] || null; }
      };
      Object.defineProperty(store, "length", { get: function () { return Object.keys(data).length; } });
      return store;
    };
    var local = makeStore();
    var session = makeStore();
    Object.defineProperty(window, "localStorage", { value: local, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: session, configurable: true });
  }

  // --- crash reporting ------------------------------------------------------
  var describe = function (value) {
    if (value && value.message) return String(value.message);
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  };

  window.addEventListener("error", function (event) {
    post("error", { message: describe(event.error || event.message) });
  });
  window.addEventListener("unhandledrejection", function (event) {
    post("error", { message: "未处理的 Promise 异常：" + describe(event.reason) });
  });

  var originalError = console.error;
  console.error = function () {
    var parts = Array.prototype.map.call(arguments, describe);
    post("console", { message: parts.join(" ") });
    originalError.apply(console, arguments);
  };

  // --- keep the preview in the preview -------------------------------------
  // A generated app that navigates would replace the frame's document and the
  // user would lose the running session with no way back.
  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node && node.nodeType === 1 && node.tagName !== "A") node = node.parentNode;
    if (!node || node.tagName !== "A") return;
    var href = node.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;
    event.preventDefault();
    post("nav", { href: href });
  }, true);

  document.addEventListener("submit", function (event) {
    if (event.target && event.target.tagName === "FORM") event.preventDefault();
  }, true);

  var announce = function () { post("ready", {}); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announce);
  } else {
    announce();
  }
  window.addEventListener("load", announce);
})();
</script>`;

export function buildPreviewDocument(html: string): string {
  if (!html) return "";
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => match + RUNTIME);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${RUNTIME}</head>`);
  }
  return RUNTIME + html;
}
