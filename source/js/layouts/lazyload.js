export default function initLazyLoad() {
  const imgs = document.querySelectorAll("img");
  const options = {
    rootMargin: "0px",
    threshold: 0.1,
  };
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const source = img.getAttribute("data-src");
        const preload = new Image();
        preload.onload = async () => {
          if (typeof preload.decode === "function") {
            await preload.decode().catch(() => {});
          }
          img.src = source;
          img.removeAttribute("lazyload");
        };
        preload.onerror = () => {
          img.src = source;
          img.removeAttribute("lazyload");
        };
        preload.src = source;
        observer.unobserve(img);
      }
    });
  }, options);
  imgs.forEach((img) => {
    if (img.hasAttribute("lazyload")) {
      observer.observe(img);
    }
  });
}
