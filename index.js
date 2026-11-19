(() => {
  // Opt-in comparison only: no font preference is saved or applied to the live site.
  const params = new URLSearchParams(window.location.search);
  // Temporary design comparison: keep the previous artwork/arrow treatment
  // available without affecting project pages or changing the chosen assets.
  const cardPreview = document.querySelector('.Home--card-preview');
  if (cardPreview && params.get('cards') === 'classic') {
    cardPreview.classList.remove('Home--card-preview');
    cardPreview.querySelectorAll('.Work-card').forEach(card => {
      const surface = card.querySelector('.Work-surface');
      if (surface) surface.replaceWith(...surface.childNodes);
      const footer = card.querySelector('.Work-footer');
      if (!footer) return;
      card.querySelector('.Work-media').append(footer.querySelector('.Card-arrow'));
      const caption = footer.querySelector('.Work-caption');
      if (caption) card.append(caption); // New default already places it below.
      footer.remove();
    });
  }
  if (params.get('compare-fonts') === '1') {
    const controls = document.createElement('div');
    controls.className = 'Font-compare';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Preview font');
    const label = document.createElement('span');
    label.textContent = 'Compare type';
    controls.append(label);
    const chosen = params.get('font') === 'inter' ? 'inter' : 'arial';
    function selectFont(font) {
      document.documentElement.dataset.previewFont = font;
      controls.querySelectorAll('button').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.font === font));
      });
      const url = new URL(window.location.href);
      url.searchParams.set('font', font);
      history.replaceState(null, '', url);
    }
    for (const font of ['arial', 'inter']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.font = font;
      button.textContent = font === 'arial' ? 'Arial' : 'Inter';
      button.addEventListener('click', () => selectFont(font));
      controls.append(button);
    }
    document.body.append(controls);
    document.body.classList.add('has-font-compare');
    selectFont(chosen);
  }
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const items = [...document.querySelectorAll('[data-reveal]')];
  const intro = [...document.querySelectorAll('[data-intro]')];
  const motionTokens = getComputedStyle(document.documentElement);
  const introHeadingDuration = parseFloat(motionTokens.getPropertyValue('--intro-heading-duration'));
  const introStep = introHeadingDuration + parseFloat(motionTokens.getPropertyValue('--reveal-stagger'));
  const root = document.documentElement;
  const typingCopy = document.querySelector('[data-typing-copy]');
  const greeting = document.querySelector('[data-intro-typing] .Visually-hidden')?.textContent;
  let introAbort;
  let introRun = 0;
  const exploreLink = document.querySelector('.Intro .Text-link');
  let cueReady = false;
  let cueVisible = false;
  let cueTimer;
  let lastCueAt = null;
  function scheduleExploreCue() {
    clearTimeout(cueTimer);
    if (!exploreLink || !cueReady || !cueVisible || document.hidden || preference.matches) return;
    const delay = lastCueAt === null ? 0 : Math.max(0, 10000 - (performance.now() - lastCueAt));
    cueTimer = setTimeout(() => {
      if (document.hidden || !cueVisible || preference.matches) return;
      exploreLink.classList.remove('is-cue-playing');
      void exploreLink.offsetWidth;
      exploreLink.classList.add('has-cue-played', 'is-cue-playing');
      lastCueAt = performance.now();
      scheduleExploreCue();
    }, delay);
  }
  if (exploreLink) {
    if ('IntersectionObserver' in window) {
      const cueObserver = new IntersectionObserver(entries => {
        cueVisible = entries[0].isIntersecting;
        if (!cueVisible) exploreLink.classList.remove('is-cue-playing');
        scheduleExploreCue();
      }, { threshold: 0.5 });
      cueObserver.observe(exploreLink);
    } else cueVisible = true;
    exploreLink.addEventListener('animationend', event => {
      if (['explore-arrow-dip', 'explore-arrow-enter'].includes(event.animationName)) {
        exploreLink.classList.add('has-cue-completed');
        exploreLink.classList.remove('is-cue-playing');
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) exploreLink.classList.remove('is-cue-playing');
      scheduleExploreCue();
    });
  }
  function finishIntro(skip = false) {
    ++introRun;
    introAbort?.abort();
    clearTimeout(window.__homeIntroFailsafe);
    root.classList.remove('is-home-intro', 'is-home-return', 'is-intro-started');
    if (typingCopy) typingCopy.textContent = greeting;
    intro.forEach(item => {
      item.classList.remove('is-pending', 'is-revealing', 'is-intro-shown');
      item.style.removeProperty('--reveal-delay');
    });
    if (skip) exploreLink?.classList.remove('has-explore-cue', 'has-cue-played', 'has-cue-completed', 'is-cue-playing');
    // Observers must not consume card entrances while the blank intro hides Work.
    items.filter(item => item.classList.contains('is-pending')).forEach(item => {
      observer?.unobserve(item);
      observer?.observe(item);
    });
    cueReady = !skip;
    scheduleExploreCue();
  }
  function introWait(ms, signal) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  async function revealIntro() {
    if (!intro.length) return;
    if (preference.matches || !root.classList.contains('is-home-intro') || window.scrollY > 20) {
      finishIntro(true);
      return;
    }
    const run = ++introRun;
    introAbort?.abort();
    introAbort = new AbortController();
    const signal = introAbort.signal;
    const active = () => run === introRun && !signal.aborted && !preference.matches;
    cueReady = false;
    lastCueAt = null;
    clearTimeout(cueTimer);
    exploreLink?.classList.remove('has-cue-played', 'has-cue-completed', 'is-cue-playing');
    exploreLink?.classList.add('has-explore-cue');
    intro.forEach(item => {
      item.classList.remove('is-revealing', 'is-intro-shown');
      item.classList.add('is-pending');
    });
    const returning = root.classList.contains('is-home-return');
    typingCopy.textContent = returning ? greeting : '';
    if (!returning) {
      const eyebrow = document.querySelector('[data-intro-typing]');
      eyebrow.classList.remove('is-pending');
      eyebrow.classList.add('is-intro-shown');
    }
    root.classList.add('is-intro-started');
    const gap = parseFloat(motionTokens.getPropertyValue('--intro-type-gap'));
    const pause = parseFloat(motionTokens.getPropertyValue('--intro-type-pause'));
    async function type(text) {
      for (const character of text) {
        if (!active()) return;
        typingCopy.textContent += character;
        await introWait(gap, signal);
      }
    }
    async function enter(elements, stagger = false) {
      elements.forEach((item, index) => {
        item.style.setProperty('--reveal-delay', (stagger ? index * introStep : 0) + 'ms');
        item.classList.remove('is-pending');
        item.classList.add('is-revealing');
      });
      const animations = elements.flatMap(item => item.getAnimations()).filter(animation =>
        ['portfolio-reveal', 'portfolio-fade'].includes(animation.animationName));
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
      if (!active()) return;
      elements.forEach(item => {
        item.classList.add('is-intro-shown');
        item.classList.remove('is-revealing');
      });
    }
    try {
      if (returning) {
        await document.fonts.ready;
        if (!active()) return;
        await enter(intro);
        if (active()) finishIntro();
        return;
      }
      await introWait(parseFloat(motionTokens.getPropertyValue('--intro-start-delay')), signal);
      if (!active()) return;
      await type('Hi.');
      if (!active()) return;
      await introWait(pause, signal);
      if (!active()) return;
      await type(greeting.slice(3));
      if (!active()) return;
      await introWait(pause, signal);
      await document.fonts.ready;
      if (!active()) return;
      await enter(intro.filter(item => item.classList.contains('Intro-line')), true);
      if (!active()) return;
      await enter(intro.filter(item => !item.classList.contains('Intro-line') && !item.hasAttribute('data-intro-typing')));
      if (!active()) return;
      finishIntro();
    } catch {
      // A failed animation should never make the portfolio inaccessible.
      if (active()) finishIntro(true);
    }
  }
  window.addEventListener('home-intro-timeout', () => finishIntro(true));
  document.addEventListener('keydown', event => {
    if (['Tab', 'Escape'].includes(event.key) && root.classList.contains('is-home-intro')) finishIntro(true);
  });
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20 && root.classList.contains('is-home-intro')) finishIntro(true);
  }, { passive: true });
  function collectScrollHeroes() {
    return [...document.querySelectorAll('.Home .Work-item--hero, [data-scroll-hero]')].map(anchor => ({
      anchor,
      media: anchor.querySelector('[data-scroll-media], .Work-media, .Case-art')
    })).filter(hero => hero.media);
  }
  let scrollHeroes = collectScrollHeroes();
  // Encrypted cases arrive only after access is granted. Reuse the existing
  // hero treatment; release references again when a project is locked.
  document.addEventListener('portfolio:protected-content', () => {
    scrollHeroes = collectScrollHeroes();
    scheduleDrift();
  });
  function updateHero() {
    // Read all geometry before writing. The stable anchor includes any Shell
    // padding; measure its content width, never the expanding artwork itself.
    const updates = scrollHeroes.map(({ anchor, media }) => {
      if (preference.matches) return { media };
      const bounds = anchor.getBoundingClientRect();
      const style = getComputedStyle(anchor);
      const width = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const top = bounds.top + window.scrollY;
      // Same scroll-driven card-resize mapping as the homepage: no timed
      // easing, scroll hijacking, or additional entrance on later galleries.
      const start = Math.max(0, top - window.innerHeight * .85);
      const end = Math.max(start + 1, top - window.innerHeight * .2);
      const progress = Math.max(0, Math.min(1, (window.scrollY - start) / (end - start)));
      const gutter = Math.max(0, (document.documentElement.clientWidth - width) / 2);
      return { media, bleed: ((1 - progress) * gutter).toFixed(3) + 'px', radius: (progress * 20).toFixed(3) + 'px' };
    });
    updates.forEach(({ media, bleed, radius }) => {
      if (bleed === undefined) {
        media.style.removeProperty('--hero-bleed');
        media.style.removeProperty('--hero-radius');
      } else {
        media.style.setProperty('--hero-bleed', bleed);
        media.style.setProperty('--hero-radius', radius);
      }
    });
  }
  const drifters = [...document.querySelectorAll('[data-drift]')];
  let observer;
  let frame = 0;
  function updateDrift() {
    frame = 0;
    updateHero();
    if (preference.matches || window.innerWidth < 761) {
      drifters.forEach(image => image.style.removeProperty('--drift-y'));
      return;
    }
    drifters.forEach(image => {
      const box = image.parentElement.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const offset = (window.innerHeight / 2 - (box.top + box.height / 2)) * Number(image.dataset.drift);
      image.style.setProperty('--drift-y', Math.max(-18, Math.min(18, offset)) + 'px');
    });
  }
  function scheduleDrift() {
    if (!frame) frame = requestAnimationFrame(updateDrift);
  }
  function setup() {
    revealIntro();
    observer?.disconnect();
    items.forEach(item => item.classList.remove('is-pending', 'is-revealing'));
    if (!preference.matches && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        // isIntersecting can fire at the first edge pixel, before crossing the
        // requested threshold. Wait for a visible slice so the fade is seen.
        if (root.classList.contains('is-home-intro')) return;
        const entering = entries.filter(entry => entry.isIntersecting && entry.intersectionRatio >= .12);
        // Stagger only cards entering together, never a long cumulative page delay.
        entering.forEach((entry, index) => {
          const item = entry.target;
          item.style.setProperty('--reveal-delay', Math.min(index, 3) * 40 + 'ms');
          item.classList.remove('is-pending');
          item.classList.add('is-revealing');
          observer.unobserve(item);
          function finishReveal(event) {
            if (event.target !== item || event.animationName !== 'portfolio-reveal') return;
            item.classList.remove('is-revealing');
            item.removeEventListener('animationend', finishReveal);
          }
          item.addEventListener('animationend', finishReveal);
        });
      }, { threshold: [0, .12] });
      items.forEach(item => {
        item.classList.add('is-pending');
        observer.observe(item);
      });
    }
    scheduleDrift();
  }
  // Keyboard focus must never land in an invisible card below the fold.
  document.addEventListener('focusin', event => {
    const item = event.target.closest('[data-reveal], [data-intro]');
    if (!item) return;
    item.classList.remove('is-pending', 'is-revealing');
    observer?.unobserve(item);
  });
  window.addEventListener('scroll', scheduleDrift, { passive: true });
  window.addEventListener('resize', scheduleDrift, { passive: true });
  window.addEventListener('load', scheduleDrift);
  window.addEventListener('pageshow', event => {
    scheduleDrift();
    // BFCache restores the DOM without re-running the head script.
    if (event.persisted && intro.length && !location.hash && window.scrollY <= 20 && !preference.matches) {
      root.classList.add('is-home-intro', 'is-home-return');
      revealIntro();
    }
  });
  window.addEventListener('pagehide', () => {
    if (root.classList.contains('is-home-intro')) finishIntro(true);
  });
  document.fonts?.ready.then(scheduleDrift);
  // The original demo is media, not newly authored UI motion. Preserve its
  // timing; give visitors control and keep it quiet offscreen/reduced-motion.
  document.querySelectorAll('[data-phone-demo]').forEach(demo => {
    const video = demo.querySelector('[data-demo-video]');
    const toggle = demo.querySelector('.Case-demo-toggle');
    let visible = false;
    let userPaused = false;
    let failed = false;
    video.muted = true;
    function syncDemo() {
      toggle.hidden = preference.matches || failed;
      if (preference.matches) demo.classList.remove('has-video');
      if (preference.matches || failed || !visible || document.hidden || userPaused) {
        video.pause();
        toggle.textContent = 'Play demo';
        return;
      }
      // Never fetch the clip for reduced motion, or before it is on screen.
      if (!video.getAttribute('src')) video.src = video.dataset.src;
      video.play().catch(error => {
        if (error.name !== 'AbortError' && visible && !document.hidden && !preference.matches) {
          userPaused = true;
          toggle.textContent = 'Play demo';
        }
      });
    }
    video.addEventListener('playing', () => {
      if (preference.matches || !visible || document.hidden || userPaused) {
        video.pause();
        return;
      }
      demo.classList.add('has-video');
      toggle.textContent = 'Pause demo';
    });
    video.addEventListener('error', () => {
      failed = true;
      demo.classList.remove('has-video');
      syncDemo();
    });
    toggle.addEventListener('click', () => {
      userPaused = !userPaused;
      syncDemo();
    });
    if ('IntersectionObserver' in window) {
      const demoObserver = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
        syncDemo();
      }, { threshold: [0, .15] });
      demoObserver.observe(demo.querySelector('.Case-demo-screen'));
    } else visible = true;
    preference.addEventListener('change', syncDemo);
    document.addEventListener('visibilitychange', syncDemo);
    syncDemo();
  });
  preference.addEventListener('change', setup);
  setup();
})();
