(function () {
  function initializePlayer() {
    const config = theme.plugins.aplayer;
    const container = document.getElementById('aplayer');
    if (!container || !['fixed', 'mini'].includes(config.type)) return;

    // Keep original cover URLs outside APlayer: its synchronous CSS assignment
    // would otherwise expose a partially downloaded cover on every track switch.
    const covers = config.audios.map((audio) => audio.cover);
    const player = new APlayer({
      container,
      mini: config.type === 'mini',
      fixed: config.type === 'fixed',
      ...(config.type === 'fixed' ? { lrcType: 3 } : {}),
      audio: config.audios.map((audio) => ({
        name: audio.name, artist: audio.artist, url: audio.url,
        cover: '', lrc: audio.lrc, theme: audio.theme,
      })),
    });
    if (config.type === 'fixed') container.querySelector('.aplayer-icon-lrc')?.click();

    const picture = container.querySelector('.aplayer-pic');
    if (!picture) return;
    const cover = document.createElement('span');
    cover.className = 'aplayer-decoded-cover';
    cover.setAttribute('aria-hidden', 'true');
    picture.prepend(cover);
    let request = 0;

    async function showCover(index) {
      const current = ++request;
      const source = covers[index];
      cover.dataset.imageState = 'pending';
      cover.style.backgroundImage = 'none';
      if (!source || !window.LeavesImages) {
        cover.dataset.imageState = 'error';
        return;
      }
      try {
        await window.LeavesImages.preload(source);
        if (current !== request) return;
        cover.style.backgroundImage = 'url(' + JSON.stringify(source) + ')';
        requestAnimationFrame(() => {
          if (current === request) cover.dataset.imageState = 'ready';
        });
      } catch (_) {
        if (current !== request) return;
        cover.dataset.imageState = 'error';
      }
    }
    player.on('listswitch', ({ index }) => showCover(index));
    player.on('destroy', () => ++request);
    showCover(player.list.index || 0);
  }

  // Modules have completed by DOMContentLoaded, including on profile pages.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlayer, { once: true });
  } else {
    initializePlayer();
  }
})();
