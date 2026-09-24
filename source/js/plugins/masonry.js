let cleanupMasonry = () => {};

export function destroyMasonry() {
  cleanupMasonry();
  cleanupMasonry = () => {};
}

export function initMasonry() {
  destroyMasonry();
  const container = document.querySelector("#masonry-container");
  if (!container) return;

  window.LeavesImages?.init(container);
  // CSS supplies a usable grid even if the layout library fails to load.
  if (!container.children.length || typeof MiniMasonry === "undefined") return;

  container.classList.add("masonry-active");
  const masonry = new MiniMasonry({
    baseWidth: window.innerWidth >= 768 ? 255 : 150,
    container,
    gutterX: 10,
    gutterY: 10,
    surroundingGutter: false,
  });
  let frame = null;
  let active = true;

  function scheduleLayout() {
    if (!active || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!active || !container.isConnected) return;
      masonry.conf.baseWidth = window.innerWidth >= 768 ? 255 : 150;
      masonry.layout();
    });
  }

  // Dimensions reserve each tile immediately. An individual decode or failure
  // can refine its layout without delaying any of the other photographs.
  container.addEventListener("load", scheduleLayout, true);
  container.addEventListener("error", scheduleLayout, true);
  container.addEventListener("leaves:image-settled", scheduleLayout);
  window.addEventListener("resize", scheduleLayout, { passive: true });
  scheduleLayout();

  cleanupMasonry = () => {
    active = false;
    if (frame !== null) cancelAnimationFrame(frame);
    container.removeEventListener("load", scheduleLayout, true);
    container.removeEventListener("error", scheduleLayout, true);
    container.removeEventListener("leaves:image-settled", scheduleLayout);
    window.removeEventListener("resize", scheduleLayout);
    masonry.destroy();
    container.classList.remove("masonry-active");
  };
}

if (typeof data === "undefined" || data.masonry) {
  if (typeof swup !== "undefined") {
    swup.hooks.before("content:replace", destroyMasonry);
    swup.hooks.on("page:view", initMasonry);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMasonry, { once: true });
  } else {
    initMasonry();
  }
}
