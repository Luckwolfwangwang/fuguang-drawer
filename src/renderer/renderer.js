'use strict';

(() => {
  const api = window.fuguang;
  if (!api) return;

  const body = document.body;
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('backdrop');
  const handle = document.getElementById('handle');
  const hint = document.getElementById('hint');
  const hintCount = document.getElementById('hintCount');
  const subtitleText = document.getElementById('subtitleText');
  const searchInput = document.getElementById('searchInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const chipsEl = document.getElementById('chips');
  const groupsEl = document.getElementById('groups');
  const emptyEl = document.getElementById('empty');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyHint = document.getElementById('emptyHint');
  const skeletonEl = document.getElementById('skeleton');
  const scrollEl = document.getElementById('scroll');
  const scrollRail = document.getElementById('scrollRail');
  const scrollThumb = document.getElementById('scrollThumb');
  const expandBtn = document.getElementById('expandBtn');
  const expandLabel = document.getElementById('expandLabel');
  const footerHint = document.getElementById('footerHint');
  const clockText = document.getElementById('clockText');
  const restoreBtn = document.getElementById('restoreBtn');
  const toastEl = document.getElementById('toast');

  const CATEGORY_FALLBACK = {
    favorite: { label: '常用', groupLabel: '常用栏目', color: '#ffcf8a', glyph: '\uE734' },
    ai: { label: 'AI 工具', groupLabel: 'AI 工具集合', color: '#b9a7ff', glyph: '\uE99A' },
    system: { label: '系统', groupLabel: '系统', color: '#9fe9ff', glyph: '\uE7F4' },
    app: { label: '应用', groupLabel: '应用', color: '#7fd4ff', glyph: '\uE8A5' },
    folder: { label: '文件夹', groupLabel: '文件夹', color: '#ffd08a', glyph: '\uE8B7' },
    document: { label: '文档', groupLabel: '文档', color: '#8fffc8', glyph: '\uE8A5' },
    image: { label: '图片', groupLabel: '图片', color: '#ffb3d9', glyph: '\uEB9F' },
    media: { label: '影音', groupLabel: '影音', color: '#c4b5ff', glyph: '\uE768' },
    other: { label: '其他', groupLabel: '其他', color: '#c8d2e4', glyph: '\uE7C3' },
  };

  let allItems = [];
  let categories = [];
  let counts = { all: 0 };
  let activeCategory = 'all';
  let query = '';
  let expanded = false;
  let loaded = false;
  let refreshing = false;
  let restoreBusy = false;

  let toastTimer = null;
  let hintTimer = null;
  let leaveTimer = null;
  let clockTimer = null;
  let wheelRaf = 0;
  let lastDate = '';
  let warningShown = false;
  let warningMessage = '';

  const timeFmt = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------
  init();

  function init() {
    bindEvents();
    api.onData(handleData);
    api.onOpen(handleOpen);
    api.onClose(handleClose);
    api.onState(handleState);
    api.onBackdrop((payload) => {
      if (!payload || !payload.dataUrl) return;
      backdrop.style.backgroundImage = `url("${payload.dataUrl}")`;
      backdrop.classList.add('has');
    });
    api.onRestoring(() => {
      body.classList.add('restoring');
    });
    api.onError((payload) => {
      body.classList.remove('restoring');
      showToast((payload && payload.message) || '出现了一个问题', true, 4200);
    });
    api.onToast((payload) => {
      if (payload && payload.message) showToast(payload.message, !!payload.error);
    });

    updateClock();
    clockTimer = setInterval(updateClock, 15000);

    api.ready();
    api.getData().then((data) => {
      if (data && !loaded) handleData(data);
    }).catch(() => {});
  }

  // -------------------------------------------------------------------
  // Incoming data
  // -------------------------------------------------------------------
  function handleData(data) {
    if (!data || !Array.isArray(data.items)) return;
    allItems = data.items;
    categories = Array.isArray(data.categories) ? data.categories : [];
    counts = data.counts || { all: allItems.length };
    loaded = true;
    warningMessage = data.warning || '';

    skeletonEl.hidden = true;
    hintCount.textContent = String(counts.all || allItems.length);
    updateSubtitle();

    buildChips();
    render();

    if (data.warning && !warningShown) {
      warningShown = true;
      if (body.classList.contains('open')) {
        showToast(data.warning, true, 5000);
      }
    }

    if (data.firstRun && !body.classList.contains('open')) {
      showHint();
    }
  }

  function updateSubtitle() {
    const now = new Date();
    const date = formatDate(now);
    const total = counts.all || allItems.length;
    subtitleText.textContent = `${date} · 已收纳 ${total} 个图标`;
  }

  function showHint() {
    body.classList.add('hint');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      body.classList.remove('hint');
      hintTimer = null;
      api.hintSeen();
    }, 9000);
  }

  function hideHint() {
    body.classList.remove('hint');
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    api.hintSeen();
  }

  // -------------------------------------------------------------------
  // Chip filters
  // -------------------------------------------------------------------
  function buildChips() {
    const frag = document.createDocumentFragment();
    const all = makeChip('all', '全部', counts.all || allItems.length, '#d9ecff');
    frag.appendChild(all);
    for (const cat of categories) {
      if (!cat.count && !cat.curated) continue;
      frag.appendChild(makeChip(cat.id, cat.label, cat.count, cat.color));
    }
    chipsEl.replaceChildren(frag);
    updateChipState();
  }

  function makeChip(id, label, count, color) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.category = id;
    btn.style.setProperty('--c', color || '#c8d2e4');
    btn.setAttribute('aria-pressed', 'false');

    const dot = document.createElement('span');
    dot.className = 'dot';
    const text = document.createElement('span');
    text.textContent = label;
    const num = document.createElement('span');
    num.className = 'count';
    num.textContent = String(count);
    btn.append(dot, text, num);
    btn.addEventListener('click', () => {
      if (activeCategory === id) return;
      activeCategory = id;
      updateChipState();
      render();
      scrollEl.scrollTop = 0;
      const active = chipsEl.querySelector('.chip.active');
      if (active) {
        // Scroll only the chip strip. scrollIntoView() can scroll the whole
        // document/window horizontally, which shifts the entire drawer.
        const chipRect = active.getBoundingClientRect();
        const boxRect = chipsEl.getBoundingClientRect();
        const delta = (chipRect.left + chipRect.width / 2) - (boxRect.left + boxRect.width / 2);
        chipsEl.scrollTo({ left: Math.max(0, chipsEl.scrollLeft + delta), behavior: 'smooth' });
      }
    });
    return btn;
  }

  function updateChipState() {
    for (const chip of chipsEl.querySelectorAll('.chip')) {
      const on = chip.dataset.category === activeCategory;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  function render() {
    if (!loaded) return;
    const q = query.trim().toLowerCase();
    const matched = allItems.filter((item) => {
      if (activeCategory !== 'all') {
        if (activeCategory === 'favorite' && !item.favorite) return false;
        if (activeCategory === 'ai' && !item.ai) return false;
        if (activeCategory !== 'favorite' && activeCategory !== 'ai'
          && item.category !== activeCategory) return false;
      }
      if (!q) return true;
      return item.displayName.toLowerCase().includes(q)
        || item.fullName.toLowerCase().includes(q)
        || (CATEGORY_FALLBACK[item.category] && CATEGORY_FALLBACK[item.category].label.includes(q));
    });

    const groups = [];
    if (activeCategory === 'all') {
      for (const cat of categories) {
        if (cat.curated) continue;
        const list = matched.filter((item) => item.category === cat.id);
        if (list.length) groups.push({ ...cat, items: list });
      }
    } else {
      const meta = categories.find((c) => c.id === activeCategory)
        || CATEGORY_FALLBACK[activeCategory]
        || { label: '图标', groupLabel: '图标', color: '#c8d2e4' };
      let list = matched.slice();
      if (activeCategory === 'favorite') {
        list.sort((a, b) => (Number(b.favoritePinned) - Number(a.favoritePinned))
          || (b.launchCount - a.launchCount)
          || a.displayName.localeCompare(b.displayName, 'zh-CN', { numeric: true }));
      } else {
        list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN', { numeric: true }));
      }
      if (list.length) groups.push({ ...meta, count: list.length, items: list });
    }

    const frag = document.createDocumentFragment();
    let index = 0;
    for (const group of groups) {
      const section = document.createElement('section');
      section.className = 'group';

      const head = document.createElement('div');
      head.className = 'group-head';
      const title = document.createElement('span');
      title.className = 'group-title';
      title.textContent = group.groupLabel || group.label;
      const line = document.createElement('span');
      line.className = 'group-line';
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = String(group.items.length);
      head.append(title, line, count);

      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const item of group.items) {
        grid.appendChild(makeItem(item, index++));
      }

      section.append(head, grid);
      frag.appendChild(section);
    }

    groupsEl.replaceChildren(frag);
    emptyEl.hidden = groups.length > 0;
    updateEmptyState(groups.length === 0);
    skeletonEl.hidden = true;
    updateFooter();
    requestAnimationFrame(updateScrollRail);
  }

  function updateEmptyState(isEmpty) {
    if (!isEmpty) return;
    if (query.trim()) {
      emptyTitle.textContent = '没有找到图标';
      emptyHint.textContent = '换一个关键词，或选择其他分类';
      return;
    }
    if (activeCategory === 'favorite') {
      emptyTitle.textContent = '常用栏目还是空的';
      emptyHint.textContent = '右键任意图标，选择“加入常用”';
      return;
    }
    if (activeCategory === 'ai') {
      emptyTitle.textContent = '还没有 AI 工具';
      emptyHint.textContent = '右键图标，选择“加入 AI 工具集合”';
      return;
    }
    emptyTitle.textContent = '这个分类还没有图标';
    emptyHint.textContent = '换一个分类，或点刷新重新扫描';
  }

  function updateScrollRail() {
    if (!scrollRail || !scrollThumb) return;
    const overflow = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (overflow < 8) {
      scrollRail.classList.remove('visible');
      return;
    }
    scrollRail.classList.add('visible');
    const track = scrollRail.clientHeight;
    const height = Math.max(24, Math.round(track * (scrollEl.clientHeight / scrollEl.scrollHeight)));
    const top = Math.max(0, Math.min(track - height,
      (scrollEl.scrollTop / overflow) * (track - height)));
    scrollThumb.style.height = `${height}px`;
    scrollThumb.style.transform = `translateY(${top}px)`;
  }

  function makeItem(item, index) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.dataset.id = item.id;
    btn.style.setProperty('--i', String(Math.min(index, 18)));
    btn.title = item.fullName;
    btn.setAttribute('aria-label', item.fullName);

    const tile = document.createElement('span');
    tile.className = 'icon-tile';
    if (item.accent) tile.style.setProperty('--accent', item.accent);

    if (item.icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = item.icon;
      img.addEventListener('error', () => {
        img.remove();
        tile.appendChild(makeFallback(item));
      }, { once: true });
      tile.appendChild(img);
    } else if (item.glyph) {
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = item.glyph;
      tile.appendChild(glyph);
    } else {
      tile.appendChild(makeFallback(item));
    }

    const name = document.createElement('span');
    name.className = 'icon-name';
    name.textContent = item.displayName;

    btn.append(tile, name);
    return btn;
  }

  function makeFallback(item) {
    const glyph = document.createElement('span');
    glyph.className = 'fallback';
    const meta = CATEGORY_FALLBACK[item.category] || CATEGORY_FALLBACK.other;
    glyph.textContent = meta.glyph;
    return glyph;
  }

  function updateFooter() {
    const total = counts.all || allItems.length;
    if (expanded) {
      expandLabel.textContent = '收起抽屉';
      footerHint.textContent = '滚轮 · 单击';
    } else {
      expandLabel.textContent = `展开全部 ${total} 个图标`;
      footerHint.textContent = '滚轮浏览';
    }
  }

  // -------------------------------------------------------------------
  // Open / close / expand
  // -------------------------------------------------------------------
  function handleOpen(payload) {
    hideHint();
    body.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    setExpanded(!!(payload && payload.expanded), false);
    scrollEl.scrollTop = 0;
    drawer.style.setProperty('--mx', '28%');
    drawer.style.setProperty('--my', '8%');
    if (!loaded) skeletonEl.hidden = false;
    setTimeout(updateScrollRail, 620);
    if (warningMessage && !warningShown) {
      warningShown = true;
      setTimeout(() => showToast(warningMessage, true, 5200), 350);
    }
  }

  function handleClose() {
    body.classList.remove('open', 'expanded');
    body.classList.remove('restoring');
    drawer.setAttribute('aria-hidden', 'true');
    expanded = false;
    updateFooter();
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    searchInput.blur();
    searchInput.value = '';
    query = '';
    activeCategory = 'all';
    updateChipState();
    render();
    scrollEl.scrollTop = 0;
    restoreBusy = false;
  }

  function handleState(payload) {
    if (!payload) return;
    if (payload.open) {
      handleOpen(payload);
    } else if (payload.firstRun) {
      showHint();
    }
  }

  function setExpanded(value, notify = true) {
    expanded = !!value;
    body.classList.toggle('expanded', expanded);
    expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    updateFooter();
    setTimeout(updateScrollRail, 640);
    if (notify) api.setExpanded(expanded);
  }

  // -------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------
  function bindEvents() {
    expandBtn.addEventListener('click', () => {
      if (expanded) {
        setExpanded(false);
        return;
      }
      if (activeCategory !== 'all' || query.trim()) {
        activeCategory = 'all';
        query = '';
        searchInput.value = '';
        updateChipState();
        render();
        scrollEl.scrollTop = 0;
      }
      setExpanded(true);
    });

    restoreBtn.addEventListener('click', async () => {
      if (restoreBusy) return;
      restoreBusy = true;
      body.classList.add('restoring');
      try {
        const result = await api.restore();
        if (!result || !result.ok) {
          restoreBusy = false;
          body.classList.remove('restoring');
          showToast((result && result.error) ? `还原失败：${result.error}` : '还原失败，请重试', true, 4500);
        }
      } catch (err) {
        restoreBusy = false;
        body.classList.remove('restoring');
        showToast('还原失败，请重试', true, 4500);
      }
    });

    refreshBtn.addEventListener('click', async () => {
      if (refreshing) return;
      refreshing = true;
      refreshBtn.classList.add('spinning');
      try {
        const data = await api.refresh();
        if (data) handleData(data);
        showToast('桌面图标已重新整理');
      } catch (err) {
        showToast('重新整理失败，请稍后再试', true);
      } finally {
        setTimeout(() => {
          refreshing = false;
          refreshBtn.classList.remove('spinning');
        }, 450);
      }
    });

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = searchInput.value || '';
        if (query && activeCategory !== 'all') {
          activeCategory = 'all';
          updateChipState();
        }
        render();
        scrollEl.scrollTop = 0;
      }, 80);
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (searchInput.value) {
          searchInput.value = '';
          query = '';
          render();
          scrollEl.scrollTop = 0;
        } else {
          searchInput.blur();
          if (expanded) setExpanded(false);
          else api.requestClose();
        }
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!body.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (searchInput.value) {
          searchInput.value = '';
          query = '';
          render();
          scrollEl.scrollTop = 0;
        } else if (expanded) {
          setExpanded(false);
        } else {
          api.requestClose();
        }
        return;
      }
      if (event.key === '/' && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    drawer.addEventListener('mouseenter', () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      api.hoverEnter();
    });

    drawer.addEventListener('mouseleave', () => {
      if (body.classList.contains('restoring')) return;
      if (document.activeElement === searchInput) return;
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (body.classList.contains('open') && document.activeElement !== searchInput) {
          api.requestClose();
        }
      }, 560);
    });

    drawer.addEventListener('pointermove', (event) => {
      if (wheelRaf) return;
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        const rect = drawer.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        drawer.style.setProperty('--mx', `${Math.max(-10, Math.min(110, x)).toFixed(1)}%`);
        drawer.style.setProperty('--my', `${Math.max(-10, Math.min(110, y)).toFixed(1)}%`);
      });
    }, { passive: true });

    scrollEl.addEventListener('wheel', (event) => {
      if (expanded || event.deltaY <= 0) return;
      const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 8;
      if (!atBottom) return;
      if (activeCategory !== 'all' || query.trim()) {
        activeCategory = 'all';
        query = '';
        searchInput.value = '';
        updateChipState();
        render();
        scrollEl.scrollTop = 0;
      }
      setExpanded(true);
    }, { passive: true });

    scrollEl.addEventListener('scroll', updateScrollRail, { passive: true });

    groupsEl.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('.item') : null;
      if (!target) return;
      launchById(target.dataset.id);
    });

    groupsEl.addEventListener('contextmenu', (event) => {
      const target = event.target instanceof Element ? event.target.closest('.item') : null;
      if (!target) return;
      event.preventDefault();
      api.contextMenu(target.dataset.id);
    });

    window.addEventListener('resize', () => {
      // Keeps the decorative sheen anchored after a DPI or work-area change.
      drawer.style.setProperty('--mx', '28%');
      drawer.style.setProperty('--my', '8%');
      requestAnimationFrame(updateScrollRail);
    });
  }

  async function launchById(id) {
    if (!id) return;
    const item = allItems.find((entry) => entry.id === id);
    const node = groupsEl.querySelector(`.item[data-id="${cssEscape(id)}"]`);
    if (node) {
      node.classList.add('launching');
      setTimeout(() => node.classList.remove('launching'), 520);
    }
    try {
      const result = await api.launch(id);
      if (result && !result.ok) {
        showToast(`打开失败：${result.error || '未知错误'}`, true, 4200);
      } else if (item && item.special) {
        // The shell opens these virtual folders asynchronously.
      }
    } catch (err) {
      showToast('打开失败，请重试', true, 4200);
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  // -------------------------------------------------------------------
  // Clock / toast
  // -------------------------------------------------------------------
  function formatDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日 ${WEEKDAYS[date.getDay()]}`;
  }

  function updateClock() {
    const now = new Date();
    clockText.textContent = timeFmt.format(now);
    const date = formatDate(now);
    if (date !== lastDate) {
      lastDate = date;
      if (loaded) updateSubtitle();
    }
  }

  function showToast(message, isError = false, duration = 2800) {
    if (!message) return;
    toastEl.textContent = message;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      toastTimer = null;
    }, duration);
  }
})();
