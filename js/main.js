/* Boscon Space — v3 interactions */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  /* ---- Smooth scroll ---- */
  let lenis = null;
  if (!reduce && typeof Lenis !== 'undefined') {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    if (hasGsap) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  /* ---- Anchors ---- */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id === '#top' ? document.body : $(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      if (lenis) lenis.scrollTo(target, { duration: 1.4 });
      else target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  /* ---- Mobile menu ---- */
  const toggle = $('#navToggle'), menu = $('#menu');
  $$('.menu__links a').forEach((a, i) => a.style.setProperty('--i', i));
  function closeMenu() {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    if (lenis) lenis.start();
  }
  toggle.addEventListener('click', () => {
    const open = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (lenis) open ? lenis.stop() : lenis.start();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ---- Nav hide on scroll down ---- */
  const nav = $('#nav');
  let lastY = 0;
  function onScroll(y) {
    if (y > lastY && y > 120) nav.classList.add('is-hidden'); else nav.classList.remove('is-hidden');
    lastY = y;
  }
  if (lenis) lenis.on('scroll', (e) => onScroll(e.scroll));
  else window.addEventListener('scroll', () => onScroll(window.scrollY), { passive: true });

  /* ---- Reveals ---- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  ['.missions__grid', '.contact__inner'].forEach((g) => $$(g).forEach((c) => $$('.rv', c).forEach((el, i) => { el.style.transitionDelay = (i * 0.08) + 's'; })));

  let introDone = false;
  function intro() {
    if (introDone) return;
    introDone = true;
    document.documentElement.classList.add('is-ready');
    // setTimeout, not rAF: rAF pauses in background tabs and the hero would stay blank
    setTimeout(() => {
      $$('.hero .line').forEach((l, i) => { l.querySelector('span').style.transitionDelay = (0.2 + i * 0.12) + 's'; l.classList.add('is-in'); });
      $$('.hero .rv').forEach((el, i) => { el.style.transitionDelay = (0.55 + i * 0.1) + 's'; el.classList.add('is-in'); });
      if (hasGsap && !reduce) gsap.fromTo('#heroImg', { scale: 1.1 }, { scale: 1, duration: 2.4, ease: 'power2.out' });
      $$('.rv:not(.hero .rv)').forEach((el) => io.observe(el));
      $$('.line:not(.hero .line)').forEach((el) => io.observe(el));
    }, 40);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(intro, intro);
  setTimeout(intro, 600);

  /* ---- Thesis: split into words ---- */
  const thesis = $('#thesisText');
  let words = [];
  if (thesis) {
    const text = thesis.textContent.trim().split(/\s+/);
    thesis.textContent = '';
    text.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'w'; s.textContent = w;
      thesis.appendChild(s);
      if (i < text.length - 1) thesis.appendChild(document.createTextNode(' '));
    });
    words = $$('.w', thesis);
  }

  /* ---- Story: sticky image swap ---- */
  const storyImgs = $$('.story__img');
  const storyCount = $('#storyCount');
  const steps = $$('.story__step');
  if (steps.length) {
    const stepIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const s = Number(en.target.dataset.step);
        storyImgs.forEach((im, k) => im.classList.toggle('is-active', k === s));
        steps.forEach((el) => el.classList.toggle('is-active', el === en.target));
        if (storyCount) storyCount.textContent = String(s + 1).padStart(2, '0') + ' — ' + String(storyImgs.length).padStart(2, '0');
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    steps.forEach((el) => stepIO.observe(el));
    steps[0].classList.add('is-active');
  }

  /* ---- Platform ledger ---- */
  const ledger = $('#ledger');
  if (ledger) {
    const rows = $$('.ledger__row', ledger);
    const imgs = $$('.ledger__frame img');
    const activate = (i) => {
      rows.forEach((r, k) => r.classList.toggle('is-active', k === i));
      imgs.forEach((im, k) => im.classList.toggle('is-active', k === i));
    };
    rows.forEach((r, i) => { r.addEventListener('mouseenter', () => activate(i)); r.addEventListener('focusin', () => activate(i)); });
    const rowIO = new IntersectionObserver((entries) => {
      if (window.innerWidth <= 960 || ledger.matches(':hover')) return;
      entries.forEach((en) => { if (en.isIntersecting) activate(rows.indexOf(en.target)); });
    }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
    rows.forEach((r) => rowIO.observe(r));
  }

  /* ---- Scroll-driven motion (GSAP) ---- */
  if (hasGsap && !reduce) {
    // Hero: photo scales into a frame as the headline leaves
    ScrollTrigger.matchMedia({
      '(min-width: 961px)': function () {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=90%', scrub: true, pin: true, anticipatePin: 1 }
        });
        tl.to('#heroText', { yPercent: -30, opacity: 0, ease: 'none', duration: 0.5 }, 0)
          .to('#heroFrame', { scale: 0.82, ease: 'none', duration: 1 }, 0)
          .to('.hero__foot', { opacity: 0, ease: 'none', duration: 0.3 }, 0);
      },
      '(max-width: 960px)': function () {
        gsap.to('#heroText', { yPercent: 20, opacity: 0, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
      }
    });

    // Thesis: words brighten with scroll
    if (words.length) {
      gsap.to(words, {
        opacity: 1, ease: 'none', stagger: 0.04,
        scrollTrigger: { trigger: '#thesis', start: 'top 70%', end: 'bottom 55%', scrub: true }
      });
    }

    // Timeline line
    const tl = $('#timeline');
    if (tl) {
      const line = document.createElement('span');
      line.className = 'timeline__line';
      tl.appendChild(line);
      gsap.to(line, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: tl, start: 'top 70%', end: 'bottom 60%', scrub: true } });
    }

    // Parallax photos
    $$('[data-parallax]').forEach((wrap) => {
      const img = wrap.querySelector('img');
      if (!img) return;
      gsap.fromTo(img, { yPercent: -7 }, { yPercent: 7, ease: 'none', scrollTrigger: { trigger: wrap, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    window.addEventListener('load', () => ScrollTrigger.refresh());
  } else if (words.length) {
    words.forEach((w) => (w.style.opacity = 1));
  }
})();
