// One lifecycle for server-rendered images and images inserted by comments/Swup.
// Real src/srcset stay on ordinary images so native lazy loading and no-JS work.
const records = new WeakMap();
const preloads = new Map();
const legacyQueued = new WeakSet();
const commentRoot = "[data-waline], #waline, .waline-container";
let mutationObserver;
let legacyObserver;

const sourceKey = (img) => `${img.getAttribute("src") || ""}\n${img.getAttribute("srcset") || ""}`;
const frameFor = (img) => {
  const parent = img.parentElement?.tagName === "PICTURE" ? img.parentElement.parentElement : img.parentElement;
  return parent?.classList.contains("image-placeholder") ? parent : null;
};

function fallbackFor(frame) {
  let fallback = frame.querySelector(".image-fallback");
  if (!fallback) {
    fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.textContent = "图片暂不可用";
    fallback.setAttribute("aria-hidden", "true");
    frame.append(fallback);
  }
  return fallback;
}

function ensureFrame(img, kind = "content") {
  let frame = frameFor(img);
  if (!frame && img.parentElement) {
    frame = document.createElement("span");
    frame.className = `image-placeholder image-placeholder--${kind}`;
    const width = Number(img.getAttribute("width")) || img.naturalWidth;
    const height = Number(img.getAttribute("height")) || img.naturalHeight;
    if (kind === "content" || kind === "qr") {
      const authoredWidth = img.style.width || (/^\d+(?:\.\d+)?%$/.test(img.getAttribute("width") || "") ? img.getAttribute("width") : "");
      frame.style.width = authoredWidth || (width ? `min(100%, ${width}px)` : "100%");
      frame.style.aspectRatio = width && height ? `${width} / ${height}` : kind === "qr" ? "1 / 1" : "4 / 3";
      if (kind === "content" && (!width || !height)) frame.dataset.imageUnknownSize = "true";
    } else if (kind === "icon") {
      // Comment emoji are inline typography. Keep their original CSS sizing.
      const size = typeof getComputedStyle === "function" ? getComputedStyle(img) : null;
      frame.style.width = size?.width && size.width !== "auto" && size.width !== "0px" ? size.width : "1.25em";
      frame.style.height = size?.height && size.height !== "auto" && size.height !== "0px" ? size.height : "1.25em";
      frame.style.margin = size?.margin || "0";
    } else if (kind === "avatar") {
      // Waline also puts avatars inside links without fixed dimensions. Capture
      // sizing before wrapping, including rules that only target parent > img.
      const size = typeof getComputedStyle === "function" ? getComputedStyle(img) : null;
      const parentSize = typeof getComputedStyle === "function" ? getComputedStyle(img.parentElement) : null;
      const dimension = (value, attribute) => /^\d+(?:\.\d+)?px$/.test(value || "") && parseFloat(value) > 0
        ? value : Number(attribute) > 0 ? `${Number(attribute)}px` : "40px";
      frame.style.width = dimension(size?.width, img.getAttribute("width"));
      frame.style.height = dimension(size?.height, img.getAttribute("height"));
      frame.style.margin = size?.margin || "0";
      frame.style.borderRadius = /[1-9]/.test(size?.borderRadius || "") ? size.borderRadius
        : /[1-9]/.test(parentSize?.borderRadius || "") ? parentSize.borderRadius : "50%";
    }
    const child = img.parentElement.tagName === "PICTURE" ? img.parentElement : img;
    child.before(frame);
    frame.append(child);
  }
  if (frame) fallbackFor(frame);
  img.setAttribute("data-image-managed", "");
  img.classList.add("managed-image");
  img.decoding = "async";
  return frame;
}

function setState(img, state) {
  const frame = frameFor(img);
  const record = records.get(img);
  img.dataset.imageState = state;
  if (!frame) return;
  frame.dataset.imageState = state;
  frame.setAttribute("aria-busy", String(state === "pending"));
  const fallback = fallbackFor(frame);
  fallback.setAttribute("aria-hidden", String(state !== "error"));
  if (state === "error") {
    fallback.textContent = img.alt ? `${img.alt}：图片暂不可用` : "图片暂不可用";
    img.setAttribute("aria-hidden", "true");
  } else if (record?.originalAriaHidden === null) {
    img.removeAttribute("aria-hidden");
  } else if (record?.originalAriaHidden !== undefined) {
    img.setAttribute("aria-hidden", record.originalAriaHidden);
  }
}

function decode(img) {
  if (typeof img.decode !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Image decode timed out")), 15000);
    Promise.resolve().then(() => img.decode()).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function begin(img, record) {
  record.resolve?.(false);
  record.version += 1;
  record.state = "pending";
  record.source = sourceKey(img);
  record.decodingSource = null;
  record.promise = new Promise((resolve) => { record.resolve = resolve; });
  setState(img, "pending");
  return record.version;
}

function settle(img, record, version, ready) {
  if (record.version !== version || record.state !== "pending") return;
  record.state = ready ? "ready" : "error";
  record.currentSrc = img.currentSrc || img.src;
  const frame = frameFor(img);
  // Unknown remote comment dimensions cannot be reserved exactly before fetching.
  // Once known, preserve the correct ratio for subsequent source changes.
  if (ready && frame?.dataset.imageUnknownSize && img.naturalWidth && img.naturalHeight) {
    frame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    frame.style.width = `min(100%, ${img.naturalWidth}px)`;
    delete frame.dataset.imageUnknownSize;
  }
  setState(img, record.state);
  record.resolve?.(ready);
  record.resolve = null;
  img.dispatchEvent(new CustomEvent("leaves:image-settled", {
    bubbles: true,
    detail: { state: record.state, source: record.currentSrc },
  }));
}

async function loaded(img, record) {
  if (record.staging) return;
  const candidate = img.currentSrc || img.src;
  if (record.source !== sourceKey(img) || (record.state !== "pending" && record.currentSrc !== candidate)) {
    begin(img, record);
  }
  if (record.state !== "pending" || record.decodingSource === candidate) return;
  const version = record.version;
  const key = sourceKey(img);
  record.decodingSource = candidate;
  let ready = img.naturalWidth > 0;
  if (ready) {
    // Some engines reject decode() for a displayable SVG/animated image. A
    // successful load with intrinsic dimensions is still a usable fallback.
    try { await decode(img); } catch { ready = img.complete && img.naturalWidth > 0; }
  }
  if (record.version !== version || sourceKey(img) !== key || (img.currentSrc || img.src) !== candidate) return;
  settle(img, record, version, ready);
}

function track(img) {
  let record = records.get(img);
  if (!record) {
    record = { version: 0, request: 0, state: null, originalAriaHidden: img.getAttribute("aria-hidden") };
    records.set(img, record);
    img.addEventListener("load", () => loaded(img, record));
    img.addEventListener("error", () => {
      if (record.staging) return;
      if (record.source !== sourceKey(img)) begin(img, record);
      settle(img, record, record.version, false);
    });
  }
  if (record.staging) return record;
  if (record.source !== sourceKey(img) || !record.promise) begin(img, record);
  if (img.complete && (img.getAttribute("src") || img.getAttribute("srcset"))) loaded(img, record);
  return record;
}

export function preload(url) {
  if (!url) return Promise.reject(new Error("Missing image source"));
  if (preloads.has(url)) return preloads.get(url);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => finish(new Error("Image load timed out")), 30000);
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      error ? reject(error) : resolve(img);
    }
    img.onload = async () => {
      try {
        if (!img.naturalWidth) throw new Error("Image is empty");
        try { await decode(img); } catch (error) {
          if (!img.complete || !img.naturalWidth) throw error;
        }
        finish();
      } catch (error) { finish(error); }
    };
    img.onerror = () => finish(new Error("Image could not be loaded"));
    img.decoding = "async";
    img.src = url;
    if (img.complete) queueMicrotask(() => img.naturalWidth ? img.onload?.() : img.onerror?.());
  });
  preloads.set(url, promise);
  // Keep a small cache for viewer arrow navigation and playlist covers.
  if (preloads.size > 32) preloads.delete(preloads.keys().next().value);
  promise.catch(() => { if (preloads.get(url) === promise) preloads.delete(url); });
  return promise;
}

export async function setSource(img, url, options = {}) {
  const frame = ensureFrame(img, options.kind);
  if (options.alt !== undefined) img.alt = options.alt;
  if (frame && options.kind) {
    for (const name of [...frame.classList]) {
      if (name.startsWith("image-placeholder--")) frame.classList.remove(name);
    }
    frame.classList.add(`image-placeholder--${options.kind}`);
    if (options.kind === "qr") delete frame.dataset.imageUnknownSize;
  }
  if (frame && options.placeholder !== undefined) {
    frame.style.setProperty("--image-preview", options.placeholder ? `url(${JSON.stringify(options.placeholder)})` : "none");
  }
  const record = track(img);
  const request = ++record.request;
  const version = begin(img, record);
  record.staging = true;
  try {
    await preload(url);
    if (record.request !== request) return false;
    record.staging = false;
    img.removeAttribute("lazyload");
    img.removeAttribute("data-src");
    img.src = url;
    record.source = sourceKey(img);
    record.decodingSource = null;
    if (img.complete) loaded(img, record);
    return record.promise;
  } catch {
    if (record.request !== request) return false;
    record.staging = false;
    settle(img, record, version, false);
    return false;
  }
}

function initImage(img) {
  if (img.closest(".image-viewer-container, [data-image-unmanaged]")) return;
  const legacy = img.hasAttribute("lazyload") && img.getAttribute("data-src");
  if (!img.hasAttribute("data-image-managed") && !legacy) {
    if (!img.closest(commentRoot)) return;
    const kind = img.closest(".wl-avatar, .wl-user-avatar, .wl-user") ? "avatar"
      : img.matches(".wl-emoji, .vemoji, .wl-reaction-img, .wl-tab img") || img.closest(".wl-emoji-popup, .wl-reaction") ? "icon" : "content";
    ensureFrame(img, kind);
  } else if (!frameFor(img)) ensureFrame(img);
  if (legacy) {
    if (records.has(img) || legacyQueued.has(img)) return;
    // Legacy decrypted/article markup remains supported without forcing below-fold downloads.
    legacyQueued.add(img);
    setState(img, "pending");
    if (typeof IntersectionObserver === "function") {
      if (!legacyObserver) legacyObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) {
          legacyObserver.unobserve(entry.target);
          setSource(entry.target, entry.target.getAttribute("data-src"));
        }
      }, { rootMargin: "200px", threshold: 0 });
      legacyObserver.observe(img);
    } else setSource(img, legacy);
    return;
  }
  track(img);
}

export function init(root = document) {
  if (root.matches?.("img")) initImage(root);
  root.querySelectorAll?.("img[data-image-managed], img[lazyload], [data-waline] img, #waline img, .waline-container img").forEach(initImage);
  if (!mutationObserver && typeof MutationObserver === "function" && document.body) {
    mutationObserver = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes") {
          if (change.target.matches("img[data-image-managed]")) {
            const record = records.get(change.target);
            if (record?.staging && record.source !== sourceKey(change.target)) {
              record.request += 1;
              record.staging = false;
            }
            track(change.target);
          }
        } else {
          for (const node of change.addedNodes) if (node.nodeType === 1) init(node);
          for (const node of change.removedNodes) if (node.nodeType === 1 && !node.isConnected) {
            // Retired Swup fragments must not stay strongly held by the legacy observer.
            const retire = (img) => { legacyObserver?.unobserve(img); legacyQueued.delete(img); };
            if (node.matches?.("img[lazyload]")) retire(node);
            node.querySelectorAll?.("img[lazyload]").forEach(retire);
          }
          // A comment renderer may replace/remove an image it originally owned.
          // Remove its now-empty runtime frame instead of leaving a blank tile.
          if (change.target?.classList.contains("image-placeholder") && !change.target.querySelector("img")) change.target.remove();
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
  }
}

const LeavesImages = { init, setSource, preload };
if (typeof window !== "undefined") window.LeavesImages = LeavesImages;
export default LeavesImages;
