// Public, source-recording demo. The existing index.js hero resize runs first;
// this controller only gates playback, never changes source timing or geometry.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-case-demo]').forEach(demo => {
    const screen = demo.querySelector('.Case-demo-screen');
    const video = demo.querySelector('video');
    const poster = demo.querySelector('[data-demo-poster]');
    const button = demo.querySelector('.Case-demo-toggle');
    const hero = demo.closest('[data-scroll-hero]');
    const media = hero?.querySelector('.Case-art');
    const viewport = window.visualViewport;
    let visible = false;
    let pausedByUser = false;
    let explicitPlay = false;
    let completed = false;
    let failed = false;
    let wasEligible = false;
    let frame = 0;
    video.muted = true;
    video.loop = false;
    function ready() {
      if (!visible || !media || !hero) return false;
      const bleed = media.style.getPropertyValue('--hero-bleed');
      if (!reduced.matches && (!bleed || parseFloat(bleed) > .001)) return false;
      const rail = hero.getBoundingClientRect();
      const style = getComputedStyle(hero);
      const width = rail.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (Math.abs(media.getBoundingClientRect().width - width) > 1) return false;
      const rect = screen.getBoundingClientRect();
      const top = viewport?.offsetTop || 0;
      const left = viewport?.offsetLeft || 0;
      return rect.width > 0 && rect.height > 0 && rect.top >= top - .5 && rect.left >= left - .5 && rect.bottom <= top + (viewport?.height || innerHeight) + .5 && rect.right <= left + (viewport?.width || document.documentElement.clientWidth) + .5;
    }
    function label() {
      if (failed) return;
      button.disabled = !ready();
      button.textContent = !ready() ? 'Scroll to play' : completed ? 'Replay demo' : video.paused ? 'Play demo' : 'Pause demo';
      button.setAttribute('aria-label', button.textContent + ': original Envoy Rules demo');
    }
    function sync() {
      const eligible = ready();
      if (eligible && !wasEligible && completed) { completed = false; pausedByUser = false; explicitPlay = false; }
      wasEligible = eligible;
      if (failed || !eligible || document.hidden || pausedByUser || completed || (reduced.matches && !explicitPlay)) {
        video.pause();
        label();
        return;
      }
      // No video request in reduced motion until an explicit Play action.
      if (!video.getAttribute('src')) video.src = video.dataset.src;
      video.play().catch(error => {
        if (error.name !== 'AbortError' && ready() && !document.hidden) { pausedByUser = true; label(); }
      });
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    }
    button.hidden = false;
    button.addEventListener('click', () => {
      if (completed) { completed = false; pausedByUser = false; explicitPlay = true; }
      else { pausedByUser = !video.paused; explicitPlay = !pausedByUser; }
      sync();
    });
    video.addEventListener('playing', () => {
      if (!ready() || document.hidden || (reduced.matches && !explicitPlay)) { sync(); return; }
      video.hidden = false;
      poster.style.visibility = 'hidden';
      label();
    });
    video.addEventListener('pause', label);
    video.addEventListener('ended', () => {
      completed = true;
      video.hidden = true;
      poster.style.visibility = '';
      video.currentTime = 0;
      label();
    });
    video.addEventListener('error', () => {
      failed = true;
      video.hidden = true;
      poster.style.visibility = '';
      button.disabled = true;
      button.textContent = 'Video unavailable · still image shown';
      button.setAttribute('aria-label', button.textContent);
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .12;
        sync();
      }, { threshold: [0, .12, 1] });
      observer.observe(screen);
    } else { visible = true; pausedByUser = true; }
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(schedule);
      observer.observe(screen);
      observer.observe(hero);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    viewport?.addEventListener('resize', schedule, { passive: true });
    viewport?.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', () => video.pause());
    window.addEventListener('pageshow', schedule);
    reduced.addEventListener('change', () => {
      explicitPlay = false;
      if (reduced.matches) { video.hidden = true; poster.style.visibility = ''; }
      schedule();
    });
    label();
  });
})();
