(() => {
  const host = document.querySelector('[data-protected-project]');
  if (!host) return;
  const slug = host.dataset.protectedProject;
  const gate = host.querySelector('[data-protected-gate]');
  const content = host.querySelector('[data-protected-content]');
  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const submit = gate.querySelector('button[type="submit"]');
  const message = gate.querySelector('[data-access-message]');
  const storageKey = 'portfolio-shopify-session-v1';
  const sessionDuration = 8 * 60 * 60 * 1000; // Absolute, shared eight-hour window.
  const namespace = 'portfolio-private:v1';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const encoder = new TextEncoder();
  const objectURLs = new Set();
  const disposers = [];
  let envelopePromise;
  let epoch = 0;
  let controller;
  let activeKey;
  let envelope;
  let assets;
  let assetPromises = new Map();
  let expiresAt = 0;
  let expiryTimer;
  let imageViewerOpen = false;
  const from64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const to64 = value => btoa(String.fromCharCode(...value));
  function readSession() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(storageKey));
      if (cached && (!Number.isSafeInteger(cached.expiresAt) || cached.expiresAt <= Date.now() || cached.expiresAt > Date.now() + sessionDuration + 5000)) {
        clearSession();
        message.textContent = 'Your session has ended. Enter the password to continue.';
        return null;
      }
      return cached;
    } catch { clearSession(); return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
  }
  function saveSession(keyId, raw, deadline) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ keyId, key: to64(raw), expiresAt: deadline })); return true; } catch { return false; }
  }
  function armExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()));
  }
  function checkExpiry() {
    if (!expiresAt) return;
    if (Date.now() < expiresAt) { armExpiry(); return; }
    lock({ focus: !document.hidden });
    message.textContent = 'Your eight-hour session has ended. Enter the password to continue.';
  }
  function busy(value, text = '') {
    submit.disabled = value;
    input.disabled = value;
    form.setAttribute('aria-busy', String(value));
    message.textContent = text;
  }
  async function getEnvelope() {
    if (!envelopePromise) envelopePromise = fetch(host.dataset.bundle, { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw Error('Unavailable');
      const value = await response.json();
      if (value.version !== 1 || value.project !== slug || value.kdf?.name !== 'PBKDF2' || value.kdf?.hash !== 'SHA-256' || value.kdf.iterations < 100000 || value.kdf.iterations > 2000000) throw Error('Unsupported bundle');
      return value;
    }).catch(error => { envelopePromise = null; throw error; });
    return envelopePromise;
  }
  async function importKey(raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  }
  async function decrypt(bytes, iv, key, aad) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(iv), additionalData: encoder.encode(aad) }, key, bytes);
  }
  function changed() { document.dispatchEvent(new Event('portfolio:protected-content')); }
  function lock({ forget = true, focus = false } = {}) {
    clearTimeout(expiryTimer);
    expiresAt = 0;
    epoch++;
    controller?.abort();
    controller = null;
    disposers.splice(0).forEach(dispose => dispose());
    content.querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    content.replaceChildren();
    content.hidden = true;
    objectURLs.forEach(url => URL.revokeObjectURL(url));
    objectURLs.clear();
    assetPromises.clear();
    activeKey = null;
    assets = null;
    envelope = null;
    if (forget) clearSession();
    input.value = '';
    host.replaceChildren(gate, content);
    busy(false);
    changed();
    if (focus) input.focus();
  }
  async function assetURL(id, run) {
    if (!assetPromises.has(id)) assetPromises.set(id, (async () => {
      const asset = assets[id];
      const url = new URL(asset.url, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith(`/assets/protected/${slug}/`)) throw Error('Invalid asset');
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw Error('Asset unavailable');
      const bytes = await decrypt(await response.arrayBuffer(), asset.iv, activeKey, `${namespace}:asset:${slug}:${id}:${envelope.keyId}`);
      if (run !== epoch) throw new DOMException('Access ended', 'AbortError');
      const blobURL = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
      objectURLs.add(blobURL);
      return blobURL;
    })().catch(error => { assetPromises.delete(id); throw error; }));
    return assetPromises.get(id);
  }
  function mountVideo(id, asset, poster, run) {
    const demo = document.createElement('div');
    demo.className = 'Protected-demo';
    const screen = document.createElement('div');
    screen.className = 'Protected-demo-screen';
    poster.replaceWith(demo);
    demo.append(screen);
    screen.append(poster);
    const video = document.createElement('video');
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-label', poster.alt);
    video.hidden = true;
    screen.append(video);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'Case-demo-toggle';
    button.textContent = 'Play demo';
    button.setAttribute('aria-label', 'Play demo: ' + poster.alt);
    screen.append(button);
    let visible = false;
    let pausedByUser = false;
    let explicitPlay = false;
    let loading;
    let failed = false;
    let disposed = false;
    let completed = false;
    let wasEligible = false;
    let guardFrame = 0;
    let geometryObserver;
    const guardedHero = poster.hasAttribute('data-play-when-inset');
    const hero = guardedHero ? poster.closest('[data-scroll-hero]') : null;
    const heroMedia = hero?.querySelector('.Case-art');
    const viewport = window.visualViewport;
    function readyForPlayback() {
      if (!visible) return false;
      if (!guardedHero) return true;
      if (!hero || !heroMedia) return false;
      // Read the existing scroll-resize result, never duplicate its timing or
      // start a second animation. Normal-motion layout must have run first.
      const bleed = heroMedia.style.getPropertyValue('--hero-bleed');
      if (!reduced.matches && (!bleed || parseFloat(bleed) > .001)) return false;
      const rail = hero.getBoundingClientRect();
      const style = getComputedStyle(hero);
      const narrowWidth = rail.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (Math.abs(heroMedia.getBoundingClientRect().width - narrowWidth) > 1) return false;
      const rect = screen.getBoundingClientRect();
      const top = viewport?.offsetTop || 0;
      const left = viewport?.offsetLeft || 0;
      const height = viewport?.height || innerHeight;
      const width = viewport?.width || document.documentElement.clientWidth;
      return rect.width > 0 && rect.height > 0 && rect.top >= top - .5 && rect.left >= left - .5 && rect.bottom <= top + height + .5 && rect.right <= left + width + .5;
    }
    function label() {
      if (disposed || failed) return;
      const waiting = guardedHero && !readyForPlayback();
      button.disabled = Boolean(loading) || waiting;
      button.textContent = loading ? 'Loading demo…' : waiting ? 'Scroll to play' : completed ? 'Replay demo' : video.paused ? 'Play demo' : 'Pause demo';
      button.setAttribute('aria-label', button.textContent + ': ' + poster.alt);
    }
    function updateEligibility() {
      if (disposed) return;
      const eligible = readyForPlayback();
      if (eligible && !wasEligible && completed) { completed = false; pausedByUser = false; explicitPlay = false; }
      wasEligible = eligible;
      sync();
    }
    function scheduleGuard() {
      if (!disposed && !guardFrame) guardFrame = requestAnimationFrame(() => { guardFrame = 0; updateEligibility(); });
    }
    async function sync() {
      if (disposed || failed || run !== epoch) return;
      const play = readyForPlayback() && !document.hidden && !imageViewerOpen && !pausedByUser && !completed && (!reduced.matches || explicitPlay);
      if (!play) { video.pause(); label(); return; }
      if (!video.getAttribute('src')) {
        if (loading) return;
        button.disabled = true;
        button.textContent = 'Loading demo…';
        loading = assetURL(id, run).then(url => { if (!disposed && run === epoch) video.src = url; }).catch(() => {
          if (disposed) return;
          failed = true;
          video.hidden = true;
          poster.style.visibility = '';
          button.textContent = 'Video unavailable · still image shown';
          button.setAttribute('aria-label', button.textContent);
        }).finally(() => { loading = null; button.disabled = failed; if (!disposed && !failed) sync(); });
        return;
      }
      try { await video.play(); } catch (error) {
        if (error.name !== 'AbortError' && !disposed && !failed && readyForPlayback() && !document.hidden) { pausedByUser = true; label(); }
      }
    }
    video.addEventListener('playing', () => {
      if (disposed || !readyForPlayback() || document.hidden || imageViewerOpen || (reduced.matches && !explicitPlay)) { sync(); return; }
      video.hidden = false;
      poster.style.visibility = 'hidden';
      label();
    });
    video.addEventListener('pause', label);
    video.addEventListener('error', () => {
      failed = true;
      video.hidden = true;
      poster.style.visibility = '';
      button.disabled = true;
      button.textContent = 'Video unavailable · still image shown';
      button.setAttribute('aria-label', button.textContent);
    });
    video.addEventListener('ended', () => {
      completed = true;
      video.hidden = true;
      poster.style.visibility = '';
      video.currentTime = 0;
      label();
    });
    button.addEventListener('click', () => {
      if (completed) { completed = false; pausedByUser = false; explicitPlay = true; }
      else { pausedByUser = !video.paused; explicitPlay = !pausedByUser; }
      sync();
    });
    const onVisibility = () => sync();
    const onPreference = () => { explicitPlay = false; if (reduced.matches) { video.hidden = true; poster.style.visibility = ''; } sync(); if (guardedHero) scheduleGuard(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('portfolio:private-image-viewer', onVisibility);
    reduced.addEventListener('change', onPreference);
    let observer;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .12;
        // Ordinary demos use viewport entry; the opening M1 also waits for the
        // final inset width and a fully visible frame. Completion never loops.
        updateEligibility();
      }, { threshold: guardedHero ? [0, .12, 1] : [0, .12] });
      observer.observe(screen);
    } else { visible = true; if (!reduced.matches) pausedByUser = true; }
    if (guardedHero) {
      // index.js schedules its existing resize mapping first; this next frame
      // checks the resulting layout. ResizeObserver also covers decoded media.
      window.addEventListener('scroll', scheduleGuard, { passive: true });
      window.addEventListener('resize', scheduleGuard, { passive: true });
      viewport?.addEventListener('resize', scheduleGuard, { passive: true });
      viewport?.addEventListener('scroll', scheduleGuard, { passive: true });
      if ('ResizeObserver' in window) {
        geometryObserver = new ResizeObserver(scheduleGuard);
        geometryObserver.observe(screen);
        if (hero) geometryObserver.observe(hero);
      }
      label();
    }
    disposers.push(() => {
      disposed = true;
      cancelAnimationFrame(guardFrame);
      geometryObserver?.disconnect();
      if (guardedHero) {
        window.removeEventListener('scroll', scheduleGuard);
        window.removeEventListener('resize', scheduleGuard);
        viewport?.removeEventListener('resize', scheduleGuard);
        viewport?.removeEventListener('scroll', scheduleGuard);
      }
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('portfolio:private-image-viewer', onVisibility);
      reduced.removeEventListener('change', onPreference);
      video.pause();
    });
  }
  function mountImageViewer(run) {
    const images = [...content.querySelectorAll('.Case-merchant-stills [data-private-image]')];
    const dialog = document.createElement('dialog');
    if (!images.length || typeof dialog.showModal !== 'function') return;
    dialog.className = 'Case-image-dialog';
    dialog.setAttribute('aria-labelledby', 'private-image-viewer-title');
    const panel = document.createElement('div');
    panel.className = 'Case-image-panel t-modal';
    const title = document.createElement('h2');
    title.id = 'private-image-viewer-title';
    title.className = 'Case-image-label';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'Case-image-close';
    const cross = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cross.setAttribute('viewBox', '0 0 24 24');
    cross.setAttribute('width', '19');
    cross.setAttribute('height', '19');
    cross.setAttribute('fill', 'none');
    cross.setAttribute('aria-hidden', 'true');
    cross.setAttribute('focusable', 'false');
    const crossPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    crossPath.setAttribute('d', 'M5 5l14 14M19 5 5 19');
    crossPath.setAttribute('stroke', 'currentColor');
    crossPath.setAttribute('stroke-width', '1.6');
    crossPath.setAttribute('stroke-linecap', 'round');
    crossPath.setAttribute('stroke-linejoin', 'round');
    cross.append(crossPath);
    close.append(cross);
    close.setAttribute('aria-label', 'Close enlarged image');
    close.autofocus = true;
    const viewport = document.createElement('div');
    viewport.className = 'Case-image-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Enlarged image; scroll to inspect at actual size');
    const large = document.createElement('img');
    large.draggable = false;
    large.tabIndex = 0;
    large.setAttribute('role', 'button');
    viewport.append(large);
    panel.append(title, close, viewport);
    dialog.append(panel);
    content.append(dialog);
    let trigger, closeTimer;
    let disposed = false;
    let closing = false;
    function notify() { document.dispatchEvent(new Event('portfolio:private-image-viewer')); }
    function resetZoom() {
      viewport.classList.remove('is-zoomed');
      viewport.scrollTo(0, 0);
      large.setAttribute('aria-pressed', 'false');
      large.setAttribute('aria-label', 'Zoom image to actual size');
    }
    function cleanup(restore = true) {
      clearTimeout(closeTimer);
      closing = false;
      panel.classList.remove('is-open', 'is-closing');
      dialog.classList.remove('is-open', 'is-closing');
      large.removeAttribute('src');
      large.alt = '';
      title.textContent = '';
      resetZoom();
      document.documentElement.classList.remove('has-case-image-modal');
      imageViewerOpen = false;
      notify();
      if (restore && trigger?.isConnected) trigger.focus({ preventScroll: true });
      trigger = null;
    }
    function finish() {
      if (dialog.open) dialog.close();
      cleanup();
    }
    function dismiss() {
      if (!dialog.open || closing) return;
      closing = true;
      panel.classList.remove('is-open');
      panel.classList.add('is-closing');
      dialog.classList.remove('is-open');
      dialog.classList.add('is-closing');
      const ms = reduced.matches ? 0 : parseFloat(getComputedStyle(dialog).getPropertyValue('--modal-close-dur')) || 150;
      if (!ms) finish(); else closeTimer = setTimeout(finish, ms);
    }
    function onClose() { if (!dialog.open && imageViewerOpen) cleanup(); }
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dismiss();
    });
    close.addEventListener('click', dismiss);
    function toggleZoom() {
      if (closing) return;
      const actual = viewport.classList.toggle('is-zoomed');
      large.setAttribute('aria-label', actual ? 'Fit image to screen' : 'Zoom image to actual size');
      large.setAttribute('aria-pressed', String(actual));
      viewport.scrollTo(0, 0);
      viewport.focus({ preventScroll: true });
    }
    large.addEventListener('click', toggleZoom);
    large.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleZoom(); }
    });
    for (const image of images) {
      const label = image.closest('figure')?.querySelector('figcaption')?.textContent.trim() || image.alt;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'Case-image-open';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-label', 'Enlarge image: ' + label);
      button.disabled = !image.complete || !image.naturalWidth;
      image.addEventListener('load', () => { if (!disposed) button.disabled = false; }, { once: true });
      image.replaceWith(button);
      button.append(image);
      button.addEventListener('click', () => {
        if (disposed || run !== epoch || dialog.open) return;
        if (!expiresAt || Date.now() >= expiresAt) { checkExpiry(); return; }
        const url = image.currentSrc || image.src;
        if (!image.naturalWidth || !url.startsWith('blob:')) return;
        trigger = button;
        title.textContent = label;
        large.alt = image.alt;
        large.src = url;
        dialog.style.setProperty('--image-aspect', image.naturalWidth / image.naturalHeight);
        dialog.style.setProperty('--image-native-height', image.naturalHeight + 'px');
        resetZoom();
        dialog.showModal();
        document.documentElement.classList.add('has-case-image-modal');
        imageViewerOpen = true;
        notify();
        // Flush the reference's initial 0.96/transparent state before opening.
        void panel.offsetWidth;
        panel.classList.add('is-open');
        dialog.classList.add('is-open');
      });
    }
    disposers.push(() => {
      disposed = true;
      clearTimeout(closeTimer);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      cleanup(false);
      dialog.remove();
    });
  }
  function render(payload, key, run) {
    activeKey = key;
    assets = payload.assets;
    controller = new AbortController();
    // Only locally authored HTML authenticated by AES-GCM reaches this sink.
    const parsed = new DOMParser().parseFromString(payload.html, 'text/html');
    content.replaceChildren(...parsed.body.childNodes);
    payload.html = '';
    gate.remove();
    content.hidden = false;
    let imageObserver;
    async function loadImage(image) {
      try {
        const url = await assetURL(image.dataset.privateImage, run);
        if (run !== epoch) return;
        image.addEventListener('load', () => { image.dataset.privateReady = ''; changed(); }, { once: true });
        image.loading = 'eager';
        image.src = url;
      } catch {
        if (run === epoch) image.alt += ' (image unavailable)';
      }
    }
    if ('IntersectionObserver' in window) {
      imageObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        loadImage(entry.target);
        imageObserver.unobserve(entry.target);
      }), { rootMargin: '350px' });
      disposers.push(() => imageObserver.disconnect());
    }
    content.querySelectorAll('[data-private-image]').forEach(image => {
      if (imageObserver) imageObserver.observe(image); else loadImage(image);
    });
    for (const [id, asset] of Object.entries(assets)) {
      if (!asset.mime.startsWith('video/')) continue;
      const poster = [...content.querySelectorAll('[data-private-image]')].find(image => image.dataset.privateImage === asset.poster);
      if (poster) mountVideo(id, asset, poster, run);
    }
    mountImageViewer(run);
    changed();
    content.querySelector('h1')?.focus({ preventScroll: true });
  }
  async function unlock(password, cached) {
    const run = ++epoch;
    busy(true, cached ? 'Opening private project…' : 'Unlocking projects…');
    let raw;
    try {
      const deadline = cached ? cached.expiresAt : Date.now() + sessionDuration;
      if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + sessionDuration + 5000) throw Error('Expired session');
      const bundle = await getEnvelope();
      if (run !== epoch) return;
      if (cached) {
        if (cached.keyId !== bundle.keyId) throw Error('Expired session');
        raw = from64(cached.key);
        if (raw.length !== 32) throw Error('Invalid session');
      } else {
        const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
        password = '';
        raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: from64(bundle.kdf.salt), iterations: bundle.kdf.iterations, hash: bundle.kdf.hash }, material, 256));
      }
      const key = await importKey(raw);
      const plaintext = await decrypt(from64(bundle.ciphertext), bundle.iv, key, `${namespace}:case:${slug}:${bundle.keyId}`);
      if (run !== epoch) return;
      if (deadline <= Date.now()) throw Error('Expired session');
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      saveSession(bundle.keyId, raw, deadline);
      expiresAt = deadline;
      armExpiry();
      envelope = bundle;
      render(payload, key, run);
    } catch (error) {
      if (run !== epoch) return;
      clearSession();
      busy(false, cached ? 'Your session has ended. Enter the password to continue.' : error.name === 'OperationError' ? 'That password didn’t unlock the projects. Please try again.' : 'The project couldn’t be opened. Check your connection and try again.');
      if (!cached) input.focus({ preventScroll: true });
    } finally {
      raw?.fill(0);
      input.value = '';
    }
  }
  if (!crypto.subtle) {
    message.textContent = 'Private projects require a secure connection (HTTPS) and a modern browser.';
    return;
  }
  submit.disabled = false;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const password = input.value;
    input.value = '';
    unlock(password, null);
  });
  document.addEventListener('visibilitychange', checkExpiry);
  window.addEventListener('focus', checkExpiry);
  window.addEventListener('pagehide', () => lock({ forget: false }));
  window.addEventListener('pageshow', event => {
    if (event.persisted) { const cached = readSession(); if (cached) unlock('', cached); }
  });
  const cached = readSession();
  if (cached) unlock('', cached);
})();
