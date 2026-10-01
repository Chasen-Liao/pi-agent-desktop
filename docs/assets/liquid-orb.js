/*!
 * Pi Agent Desktop — landing page liquid thinking orb.
 *
 * Framework-free port of `components/LiquidOrbCanvas.tsx` + the label part of
 * `components/AgentThinkingOrb.tsx`. The WGSL and the uniform seed come from
 * `docs/assets/liquid-orb.wgsl.js`, which `scripts/sync-landing-orb.mjs`
 * generates from `components/liquid-orb-source.ts` — so this renders the real
 * production orb, not an illustration of it.
 *
 * Every lifecycle rule from the product component is preserved:
 *   - 30fps cap, DPR capped at 2
 *   - paused by IntersectionObserver and by document visibility
 *   - frozen (not looped) under prefers-reduced-motion
 *   - any WebGPU failure, device loss, or uncaptured error degrades to the
 *     same CSS fallback the app uses, and says so via data-renderer
 *
 * Landing-page additions: the GPU device is not requested until the orb is
 * near the viewport, and the status label cycles the app's real zh-CN strings.
 */
(function () {
  "use strict";

  var payload = window.PI_LIQUID_ORB;
  if (!payload || !payload.wgsl) return;

  /* Real strings from lib/i18n zh-CN: agent.thinking / agent.waitingModel /
     agent.runningTool / agent.runningManyTools, with real pi tool names. */
  var LABELS = [
    "正在思考…",
    "正在等待模型…",
    "正在运行 read…",
    "正在运行 edit…",
    "正在运行 bash、grep（另有 2 项）…",
    "正在运行 ls、read、write（另有 3 项）…"
  ];
  var LABEL_INTERVAL = 2600;
  var TARGET_FPS = 30;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------------------------------------------------------- engine */
  /* One device + pipeline for every orb on the page; one uniform buffer each. */
  var enginePromise = null;

  function getEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = (async function () {
      if (!navigator.gpu) throw new Error("no-webgpu");
      var adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("no-adapter");

      var device = await adapter.requestDevice();
      var shaderModule = device.createShaderModule({ code: payload.wgsl });
      var info = await shaderModule.getCompilationInfo();
      if (info.messages.some(function (m) { return m.type === "error"; })) {
        device.destroy();
        throw new Error("shader-compile");
      }

      var format = navigator.gpu.getPreferredCanvasFormat();
      var pipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_main" },
        fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format: format }] },
        primitive: { topology: "triangle-list" }
      });

      return { device: device, pipeline: pipeline, format: format };
    })().catch(function (err) {
      // A failed attempt must not poison later retries.
      enginePromise = null;
      throw err;
    });
    return enginePromise;
  }

  /* ------------------------------------------------------------------ host */
  function mount(host) {
    var canvas = host.querySelector("[data-orb-canvas]");
    var fallback = host.querySelector("[data-orb-fallback]");
    var statusEl = host.querySelector("[data-orb-status]");
    var badge = host.querySelector("[data-orb-renderer]");
    if (!canvas) return;

    var stopped = false;
    var failed = false;
    var inView = false;
    var started = false;
    var frame = 0;
    var lastRenderedAt = 0;
    var labelTimer = 0;
    var labelIndex = 0;

    var device = null;
    var context = null;
    var pipeline = null;
    var uniformBuffer = null;
    var bindGroup = null;
    var values = new Float32Array(payload.seed);
    var startedAt = 0;

    /* ---- status label -------------------------------------------------- */
    function paintLabel(text) {
      if (!statusEl || statusEl.textContent === text) return;
      // Restart the enter animation the same way the product does: remove the
      // class, force a reflow, re-add it.
      statusEl.classList.remove("is-enter-start");
      void statusEl.offsetWidth;
      statusEl.textContent = text;
      statusEl.classList.add("is-enter-start");
    }

    function cycleLabels() {
      window.clearInterval(labelTimer);
      labelTimer = 0;
      if (!statusEl) return;
      if (reduceMotion.matches) {
        paintLabel(LABELS[0]);
        return;
      }
      labelTimer = window.setInterval(function () {
        labelIndex = (labelIndex + 1) % LABELS.length;
        paintLabel(LABELS[labelIndex]);
      }, LABEL_INTERVAL);
    }

    function stopLabels() {
      window.clearInterval(labelTimer);
      labelTimer = 0;
    }

    /* ---- fallback ------------------------------------------------------ */
    function degrade(reason) {
      if (stopped || failed) return;
      failed = true;
      // If a previous stage recorded a message, keep it in the reason slot so
      // the DOM explains itself without a console.
      var detail = host.getAttribute("data-renderer-error");
      if (detail) reason = reason + ": " + detail;
      cancelAnimationFrame(frame);
      frame = 0;
      stopLabels();
      if (context) {
        try { context.unconfigure(); } catch (_) {}
      }
      if (device) {
        try { device.destroy(); } catch (_) {}
      }
      context = null;
      device = null;

      canvas.hidden = true;
      if (fallback) fallback.hidden = false;
      host.setAttribute("data-renderer", "fallback");
      if (reason) host.setAttribute("data-renderer-reason", reason);
      if (badge) {
        badge.textContent = "CSS 回退";
        badge.setAttribute("data-state", "fallback");
      }
    }

    /* ---- render loop --------------------------------------------------- */
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function frameOnce(now) {
      frame = 0;
      if (stopped || failed || !device || !context) return;

      if (!reduceMotion.matches && now - lastRenderedAt < 1000 / TARGET_FPS) {
        frame = requestAnimationFrame(frameOnce);
        return;
      }
      lastRenderedAt = now;

      try {
        values[0] = canvas.width;
        values[1] = canvas.height;
        // Under reduced motion the shader still renders one static pose.
        values[2] = reduceMotion.matches ? 0 : (now - startedAt) / 1000;
        values[3] = Number(host.getAttribute("data-orb-speed")) || 3;
        device.queue.writeBuffer(uniformBuffer, 0, values);

        var encoder = device.createCommandEncoder();
        var pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store"
          }]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);

        if (!reduceMotion.matches && inView && document.visibilityState === "visible") {
          frame = requestAnimationFrame(frameOnce);
        }
      } catch (err) {
        // Surface the reason: a silent degrade hides real WebGPU bugs.
        if (window.console && console.warn) {
          console.warn("[liquid-orb] render failed:", err && err.message ? err.message : err);
        }
        host.setAttribute("data-renderer-error", (err && err.message) || String(err));
        degrade("render-error");
      }
    }

    function resume() {
      if (stopped || failed || !inView || frame) return;
      if (document.visibilityState !== "visible") return;
      frame = requestAnimationFrame(frameOnce);
    }

    function pause() {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") pause();
      else resume();
    }

    function onMotionChange() {
      pause();
      lastRenderedAt = 0;
      cycleLabels();
      resume();
    }

    /* ---- boot ---------------------------------------------------------- */
    var resizeObserver = null;
    var viewObserver = null;
    var onGpuError = null;
    var lostHandler = null;

    async function boot() {
      var engine;
      try {
        engine = await getEngine();
      } catch (err) {
        degrade((err && err.message) || "no-webgpu");
        return;
      }
      if (stopped) return;

      device = engine.device;
      pipeline = engine.pipeline;
      context = canvas.getContext("webgpu");
      if (!context) {
        degrade("no-context");
        return;
      }
      context.configure({ device: device, format: engine.format, alphaMode: "premultiplied" });

      var byteLength = values.byteLength;
      uniformBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      });

      startedAt = performance.now();
      resize();

      onGpuError = function (event) {
        event.preventDefault();
        degrade("gpu-error");
      };
      lostHandler = function () { degrade("device-lost"); };
      device.addEventListener("uncapturederror", onGpuError);
      device.lost.then(lostHandler);

      resizeObserver = new ResizeObserver(function () {
        resize();
        lastRenderedAt = 0;
        resume();
      });
      resizeObserver.observe(canvas);

      host.setAttribute("data-renderer", "webgpu");
      if (badge) {
        badge.textContent = "WebGPU";
        badge.setAttribute("data-state", "webgpu");
      }
      started = true;
      resume();
    }

    /* Don't ask for a GPU adapter until the orb is near the viewport.
       `data-orb-eager` skips the wait (used by the offline preview harness,
       where headless Chrome never delivers IntersectionObserver callbacks). */
    function isEager() {
      return host.hasAttribute("data-orb-eager");
    }

    viewObserver = new IntersectionObserver(function (entries) {
      var entry = entries[0];
      inView = entry ? entry.isIntersecting : true;
      if (inView) {
        if (!started) {
          boot();
          cycleLabels();
        } else {
          resume();
        }
      } else {
        pause();
        stopLabels();
      }
    }, { rootMargin: "200px 0px" });
    viewObserver.observe(host);

    if (isEager()) {
      inView = true;
      boot();
      cycleLabels();
    }

    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", onMotionChange);

    window.addEventListener("pagehide", function () {
      stopped = true;
      pause();
      stopLabels();
    });
  }

  function init() {
    var hosts = document.querySelectorAll("[data-liquid-orb]");
    for (var i = 0; i < hosts.length; i += 1) mount(hosts[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
