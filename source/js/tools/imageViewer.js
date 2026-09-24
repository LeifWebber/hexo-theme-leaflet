import { preload } from "../utils/image-loading.js";

let disposeViewer;
const imageSelector = ".markdown-body img, .masonry-item img, .shuoshuo-content img, #shuoshuo-content img";
const excludedSelector = ".image-viewer-container, .image-placeholder--qr, .image-placeholder--avatar, .image-placeholder--icon, [data-image-no-viewer]";

export default function imageViewer() {
  // Swup calls this initializer repeatedly; retire document listeners and any
  // unresolved work from the previous page before binding the current viewer.
  disposeViewer?.();
  const mask = document.querySelector(".image-viewer-container");
  const target = mask?.querySelector("img");
  if (!mask || !target) return;

  let opened = false;
  let request = 0;
  let images = [];
  let index = 0;
  let scale = 1;
  let x = 0;
  let y = 0;
  let lastX = 0;
  let lastY = 0;
  let mouseDown = false;
  let dragged = false;
  let previousOverflow;
  let previousFocus;
  const listeners = [];
  const listen = (element, type, handler, options) => {
    element.addEventListener(type, handler, options);
    listeners.push(() => element.removeEventListener(type, handler, options));
  };
  const transform = () => { target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const resetZoom = () => { scale = 1; x = 0; y = 0; mouseDown = false; dragged = false; transform(); };

  mask.setAttribute("role", "dialog");
  mask.setAttribute("aria-modal", "true");
  mask.setAttribute("aria-label", "图片查看器，使用方向键切换，Escape 关闭");
  mask.setAttribute("tabindex", "-1");
  mask.setAttribute("aria-hidden", "true");
  let status = mask.querySelector(".image-viewer-status");
  if (!status) {
    status = document.createElement("div");
    status.className = "image-viewer-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    mask.append(status);
  }
  status.hidden = true;

  const state = (value) => {
    mask.dataset.imageState = value;
    mask.setAttribute("aria-busy", String(value === "pending"));
    status.hidden = value === "ready";
    status.replaceChildren();
    if (value === "pending") status.textContent = "图片加载中…";
    if (value === "error") {
      status.textContent = "图片暂不可用";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "重试";
      retry.addEventListener("click", (event) => { event.stopPropagation(); showImage(); });
      status.append(retry);
    }
  };

  const showImage = async () => {
    const source = images[index];
    if (!source) return;
    const version = ++request;
    resetZoom();
    state("pending");
    // Prefer the source selected by <picture>/srcset without altering the page.
    const url = source.getAttribute("data-src") || source.currentSrc || source.src;
    try {
      await preload(url);
      if (!opened || request !== version) return;
      target.alt = source.alt || "图片";
      target.src = url;
      if (typeof target.decode === "function") {
        try { await target.decode(); } catch (error) {
          if (!target.complete || !target.naturalWidth) throw error;
        }
      }
      if (!opened || request !== version) return;
      state("ready");
    } catch {
      if (opened && request === version) state("error");
    }
  };

  const close = () => {
    request += 1;
    if (opened) {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    }
    opened = false;
    mask.classList.remove("active");
    mask.setAttribute("aria-hidden", "true");
    mask.setAttribute("aria-busy", "false");
    status.hidden = true;
    resetZoom();
  };

  listen(document, "click", (event) => {
    const element = event.target;
    const image = element.closest?.("img") || element.closest?.('.image-placeholder[data-image-state="error"]')?.querySelector("img");
    if (!image?.matches(imageSelector) || image.closest(excludedSelector)) return;
    event.preventDefault();
    images = [...document.querySelectorAll(imageSelector)].filter((img) => !img.closest(excludedSelector));
    index = images.indexOf(image);
    previousOverflow = document.body.style.overflow;
    previousFocus = document.activeElement;
    opened = true;
    document.body.style.overflow = "hidden";
    mask.classList.add("active");
    mask.setAttribute("aria-hidden", "false");
    mask.focus({ preventScroll: true });
    showImage();
  });

  listen(document, "keydown", (event) => {
    if (!opened) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      index = (index + delta + images.length) % images.length;
      showImage();
    } else if (event.key === "Tab") {
      // The only transient focusable control is Retry; keep focus in the dialog.
      event.preventDefault();
      (status.querySelector("button") || mask).focus();
    }
  });

  listen(mask, "click", (event) => {
    if (event.target.closest?.("button")) return;
    if (!dragged) close();
    dragged = false;
  });
  listen(target, "wheel", (event) => {
    if (!opened || mask.dataset.imageState !== "ready") return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const oldScale = scale;
    scale = Math.min(Math.max(0.8, scale - event.deltaY * 0.001), 4);
    if (oldScale < scale) {
      x -= (event.clientX - rect.left - rect.width / 2) * (scale - oldScale);
      y -= (event.clientY - rect.top - rect.height / 2) * (scale - oldScale);
    } else { x = 0; y = 0; }
    transform();
  }, { passive: false });
  listen(target, "mousedown", (event) => {
    if (mask.dataset.imageState !== "ready") return;
    event.preventDefault();
    mouseDown = true;
    lastX = event.clientX;
    lastY = event.clientY;
    target.style.cursor = "grabbing";
  });
  listen(target, "mousemove", (event) => {
    if (!mouseDown) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    x += dx;
    y += dy;
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
    transform();
  });
  const endDrag = () => { mouseDown = false; target.style.cursor = "grab"; };
  listen(target, "mouseup", endDrag);
  listen(target, "mouseleave", endDrag);
  disposeViewer = () => { close(); listeners.forEach((remove) => remove()); };
}
