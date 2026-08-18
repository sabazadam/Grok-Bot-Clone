// Runs in the PAGE's main world. Softens the most common automation / VM / headless
// fingerprint tells. Best-effort and deliberately conservative to avoid breaking sites.
(function () {
  "use strict";

  const def = (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, { get: () => value, configurable: true });
    } catch (e) {
      /* ignore */
    }
  };

  // 1. navigator.webdriver — should be absent for a "real" browser.
  try {
    if ("webdriver" in navigator) delete Navigator.prototype.webdriver;
    def(navigator, "webdriver", undefined);
  } catch (e) {
    /* ignore */
  }

  // 2. navigator.languages — keep consistent with the UA locale.
  const lang = (navigator.language || "en-US");
  def(navigator, "languages", Object.freeze([lang, lang.split("-")[0] || "en"]));

  // 3. window.chrome — present in real Chrome, often missing in stripped builds.
  try {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {};
    }
  } catch (e) {
    /* ignore */
  }

  // 4. WebGL vendor/renderer — hide software renderers (SwiftShader/llvmpipe) which
  //    strongly signal a VM/headless environment; report a plausible Intel GPU.
  const VENDOR = "Intel Inc.";
  const RENDERER = "Intel Iris OpenGL Engine";
  const patchGL = (proto) => {
    if (!proto || !proto.getParameter) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
      if (p === 37445) return VENDOR;
      if (p === 37446) return RENDERER;
      // VENDOR (0x1F00) / RENDERER (0x1F01) fallbacks
      if (p === 0x1f00) return VENDOR;
      if (p === 0x1f01) return RENDERER;
      return orig.call(this, p);
    };
  };
  try {
    patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  } catch (e) {
    /* ignore */
  }

  // 5. Canvas — add tiny, stable-per-session noise so the fingerprint isn't a
  //    pixel-perfect constant across the fleet, without visibly altering content.
  try {
    const seed = (function () {
      let s = 0;
      const k = String(navigator.userAgent) + "|" + lang;
      for (let i = 0; i < k.length; i++) s = (s * 31 + k.charCodeAt(i)) & 0xffffffff;
      return s >>> 0;
    })();
    const jitter = (v, i) => {
      // deterministic ±1 LSB tweak
      return (v + (((seed >> (i % 24)) & 1) ? 1 : -1) * ((i % 7) === 0 ? 1 : 0)) & 0xff;
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      const data = origGetImageData.apply(this, arguments);
      const d = data.data;
      for (let i = 0; i < d.length; i += 997 * 4) {
        d[i] = jitter(d[i], i);
      }
      return data;
    };
  } catch (e) {
    /* ignore */
  }

  // 6. AudioContext — nudge the fingerprint slightly.
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && AC.prototype && AC.prototype.createAnalyser) {
      const orig = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function (arr) {
        orig.call(this, arr);
        for (let i = 0; i < arr.length; i += 100) arr[i] = arr[i] + 1e-4;
        return;
      };
    }
  } catch (e) {
    /* ignore */
  }
})();
