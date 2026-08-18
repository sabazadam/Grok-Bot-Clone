// Runs in the isolated content-script world at document_start. It injects inject.js
// into the PAGE's main world synchronously so the patches apply before page scripts run.
(function () {
  try {
    const src = chrome.runtime.getURL("inject.js");
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    (document.head || document.documentElement).prepend(s);
    s.remove();
  } catch (e) {
    /* ignore */
  }
})();
