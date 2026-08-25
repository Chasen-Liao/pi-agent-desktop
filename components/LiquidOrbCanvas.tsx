"use client";

import { useEffect, useRef, useState } from "react";
import { LIQUID_ORB_SHADER, LIQUID_ORB_UNIFORM_SEED } from "./liquid-orb-source";

interface Props {
  speed?: number;
}

export function LiquidOrbCanvas({ speed = 3 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  const [webGpuFailed, setWebGpuFailed] = useState(false);
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let stopped = false;
    let failed = false;
    let canvasVisible = true;
    let animationFrame = 0;
    let lastRenderedAt = 0;
    let device: GPUDevice | null = null;
    let context: GPUCanvasContext | null = null;
    let removeRuntimeListeners: (() => void) | undefined;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stopWithFallback = () => {
      if (stopped || failed) return;
      failed = true;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      removeRuntimeListeners?.();
      removeRuntimeListeners = undefined;
      context?.unconfigure();
      device?.destroy();
      context = null;
      device = null;
      setWebGpuFailed(true);
    };

    const start = async () => {
      if (!navigator.gpu) throw new Error("WebGPU unavailable");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter");

      device = await adapter.requestDevice();
      if (stopped) {
        device.destroy();
        return;
      }

      context = canvas.getContext("webgpu");
      if (!context) throw new Error("No WebGPU canvas context");

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      const shader = device.createShaderModule({ code: LIQUID_ORB_SHADER });
      const compilation = await shader.getCompilationInfo();
      if (compilation.messages.some((message) => message.type === "error")) {
        throw new Error("Liquid orb shader compilation failed");
      }

      const pipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: shader, entryPoint: "vs_main" },
        fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      if (stopped) return;

      const values = new Float32Array(LIQUID_ORB_UNIFORM_SEED);
      const uniformBuffer = device.createBuffer({
        size: values.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      const startedAt = performance.now();
      let renderWidth = 1;
      let renderHeight = 1;

      const updateCanvasSize = (cssWidth: number, cssHeight: number) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderWidth = Math.max(1, Math.round(cssWidth * dpr));
        renderHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
          canvas.width = renderWidth;
          canvas.height = renderHeight;
        }
      };
      updateCanvasSize(canvas.clientWidth, canvas.clientHeight);

      const render = (now: number) => {
        animationFrame = 0;
        if (stopped || failed || !device || !context) return;

        if (!reduceMotion.matches && now - lastRenderedAt < 1000 / 30) {
          animationFrame = requestAnimationFrame(render);
          return;
        }
        lastRenderedAt = now;

        try {
          values[0] = renderWidth;
          values[1] = renderHeight;
          values[2] = reduceMotion.matches ? 0 : (now - startedAt) / 1000;
          values[3] = speedRef.current;
          device.queue.writeBuffer(uniformBuffer, 0, values);

          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
          device.queue.submit([encoder.finish()]);

          if (!reduceMotion.matches && canvasVisible && document.visibilityState === "visible") {
            animationFrame = requestAnimationFrame(render);
          }
        } catch {
          stopWithFallback();
        }
      };

      const resume = () => {
        if (!stopped && !failed && canvasVisible && !animationFrame && document.visibilityState === "visible") {
          animationFrame = requestAnimationFrame(render);
        }
      };
      const handleVisibility = () => {
        if (document.visibilityState === "hidden") {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        } else {
          resume();
        }
      };
      const handleMotionPreference = () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        lastRenderedAt = 0;
        resume();
      };

      const visibilityObserver = new IntersectionObserver(([entry]) => {
        canvasVisible = entry?.isIntersecting ?? true;
        if (canvasVisible) resume();
        else {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
      });
      const resizeObserver = new ResizeObserver(([entry]) => {
        const rect = entry?.contentRect;
        if (rect) updateCanvasSize(rect.width, rect.height);
        lastRenderedAt = 0;
        resume();
      });
      const handleGpuError = (event: GPUUncapturedErrorEvent) => {
        event.preventDefault();
        stopWithFallback();
      };

      document.addEventListener("visibilitychange", handleVisibility);
      reduceMotion.addEventListener("change", handleMotionPreference);
      device.addEventListener("uncapturederror", handleGpuError);
      device.lost.then(() => stopWithFallback());
      visibilityObserver.observe(canvas);
      resizeObserver.observe(canvas);
      resume();

      return () => {
        document.removeEventListener("visibilitychange", handleVisibility);
        reduceMotion.removeEventListener("change", handleMotionPreference);
        device?.removeEventListener("uncapturederror", handleGpuError);
        visibilityObserver.disconnect();
        resizeObserver.disconnect();
      };
    };

    start()
      .then((removeListeners) => {
        if (stopped || failed) removeListeners?.();
        else removeRuntimeListeners = removeListeners;
      })
      .catch(stopWithFallback);

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      removeRuntimeListeners?.();
      context?.unconfigure();
      device?.destroy();
    };
  }, []);

  return (
    <span className="liquid-thinking-orb" aria-hidden="true">
      <canvas ref={canvasRef} className={webGpuFailed ? "hidden" : "liquid-thinking-canvas"} />
      {webGpuFailed && <span className="liquid-thinking-fallback" />}
    </span>
  );
}
