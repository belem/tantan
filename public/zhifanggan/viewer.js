import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const PDF_URL = 'zhifanggan.pdf';

const MAX_PAGE_WIDTH = 900;      // 桌面端单页最大展示宽度（CSS 像素）
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const CANVAS_MAX_WIDTH = 2400;   // 画布像素上限，避免高倍缩放时占用过多内存
const CANVAS_MAX_PIXELS = 5200000;
const RENDER_MARGIN = 900;       // 预渲染距离（屏幕上下各 900px 内的页面）
const KEEP_MARGIN = 2400;        // 超出该距离的页面释放画布内存

const viewer = document.getElementById('viewer');
const pagesEl = document.getElementById('pages');
const loadingEl = document.getElementById('loading');
const loadingTextEl = document.getElementById('loadingText');
const loadingProgressEl = document.getElementById('loadingProgress');
const errorEl = document.getElementById('error');
const pageInfoEl = document.getElementById('pageInfo');
const zoomInfoEl = document.getElementById('zoomInfo');
const prevBtn = document.getElementById('prevPage');
const nextBtn = document.getElementById('nextPage');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomInBtn = document.getElementById('zoomIn');
const zoomResetBtn = document.getElementById('zoomReset');

const state = {
    pdf: null,
    views: [],
    pageWidth: 0,
    zoom: 1,
    layoutGen: 0,
    currentPage: 1,
    ready: false,
};

let resizeTimer = 0;
let scrollFrame = 0;
let lastSweep = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 元素在滚动容器内容坐标系中的顶部位置 */
function elementTop(el) {
    return el.getBoundingClientRect().top - viewer.getBoundingClientRect().top + viewer.scrollTop;
}

function layoutPages() {
    const compact = viewer.clientWidth < 640;
    const gutter = compact ? 12 : 24;
    viewer.style.setProperty('--gutter', `${gutter}px`);

    const available = Math.max(200, viewer.clientWidth - gutter * 2);
    const fitWidth = Math.min(available, MAX_PAGE_WIDTH);
    state.pageWidth = Math.round(fitWidth * state.zoom);

    for (const view of state.views) {
        view.el.style.width = `${state.pageWidth}px`;
    }
}

async function createPages(pdf) {
    const fragment = document.createDocumentFragment();
    const views = [];

    for (let num = 1; num <= pdf.numPages; num += 1) {
        const page = await pdf.getPage(num);
        const base = page.getViewport({ scale: 1 });

        const el = document.createElement('div');
        el.className = 'page';
        el.dataset.page = String(num);
        el.style.aspectRatio = `${base.width} / ${base.height}`;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', `第 ${num} 页，共 ${pdf.numPages} 页`);

        const canvas = document.createElement('canvas');
        canvas.className = 'page-canvas';
        el.appendChild(canvas);
        fragment.appendChild(el);

        views.push({
            num,
            el,
            canvas,
            page,
            base,
            gen: -1,
            rendering: false,
            failed: false,
            token: 0,
            task: null,
        });
    }

    pagesEl.appendChild(fragment);
    state.views = views;
}

async function renderView(view) {
    if (view.failed || view.gen === state.layoutGen || view.rendering) {
        return;
    }

    view.rendering = true;
    const token = ++view.token;
    const gen = state.layoutGen;

    try {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = (state.pageWidth / view.base.width) * dpr;

        // 画布分辨率上限，兼顾清晰度与内存
        const maxByWidth = CANVAS_MAX_WIDTH / view.base.width;
        const maxByPixels = Math.sqrt(CANVAS_MAX_PIXELS / (view.base.width * view.base.height));
        scale = Math.min(scale, maxByWidth, maxByPixels);

        const viewport = view.page.getViewport({ scale });
        const canvas = view.canvas;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const task = view.page.render({ canvasContext: context, viewport });
        view.task = task;
        await task.promise;

        if (token !== view.token || gen !== state.layoutGen) {
            return;
        }

        view.gen = gen;
        view.el.classList.remove('failed');
        view.el.classList.add('rendered');
    } catch (error) {
        if (error && error.name === 'RenderingCancelledException') {
            return;
        }
        if (token !== view.token) {
            return;
        }
        console.error(`渲染第 ${view.num} 页失败`, error);
        view.failed = true;
        view.el.classList.remove('rendered');
        view.el.classList.add('failed');
    } finally {
        if (token === view.token) {
            view.rendering = false;
            view.task = null;
        }
    }
}

function invalidateViews() {
    state.layoutGen += 1;

    for (const view of state.views) {
        view.token += 1;
        view.rendering = false;
        view.failed = false;

        if (view.task) {
            try {
                view.task.cancel();
            } catch (error) {
                /* 忽略取消失败 */
            }
            view.task = null;
        }
    }
}

function unloadView(view) {
    if (view.gen === -1 && !view.rendering) {
        return;
    }

    view.token += 1;

    if (view.task) {
        try {
            view.task.cancel();
        } catch (error) {
            /* 忽略取消失败 */
        }
        view.task = null;
    }

    view.rendering = false;
    view.gen = -1;
    view.el.classList.remove('rendered');

    if (view.canvas.width || view.canvas.height) {
        view.canvas.width = 0;
        view.canvas.height = 0;
    }
}

function renderNearby(margin = RENDER_MARGIN) {
    if (!state.ready) {
        return;
    }

    const top = viewer.scrollTop - margin;
    const bottom = viewer.scrollTop + viewer.clientHeight + margin;

    for (const view of state.views) {
        const viewTop = elementTop(view.el);
        if (viewTop < bottom && viewTop + view.el.offsetHeight > top) {
            renderView(view);
        }
    }
}

function unloadFarPages(force = false) {
    if (!state.ready) {
        return;
    }

    const now = performance.now();
    if (!force && now - lastSweep < 350) {
        return;
    }
    lastSweep = now;

    const margin = Math.max(KEEP_MARGIN, viewer.clientHeight * 2);
    const top = viewer.scrollTop - margin;
    const bottom = viewer.scrollTop + viewer.clientHeight + margin;

    for (const view of state.views) {
        const viewTop = elementTop(view.el);
        if (viewTop > bottom || viewTop + view.el.offsetHeight < top) {
            unloadView(view);
        }
    }
}

function updateCurrentPage() {
    if (!state.views.length) {
        return;
    }

    let current = state.currentPage;
    const atTop = viewer.scrollTop <= 2;
    const atBottom = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2;

    if (atTop) {
        current = 1;
    } else if (atBottom) {
        current = state.views.length;
    } else {
        const probe = viewer.scrollTop + Math.min(140, viewer.clientHeight * 0.3);
        let bestDistance = Infinity;

        for (const view of state.views) {
            const top = elementTop(view.el);
            const height = view.el.offsetHeight;

            if (probe >= top && probe < top + height) {
                current = view.num;
                break;
            }

            const distance = probe < top ? top - probe : probe - (top + height);
            if (distance < bestDistance) {
                bestDistance = distance;
                current = view.num;
            }
        }
    }

    if (current !== state.currentPage) {
        state.currentPage = current;
        updatePageInfo();
    }
}

function updatePageInfo() {
    pageInfoEl.textContent = state.pdf ? `${state.currentPage} / ${state.pdf.numPages}` : '– / –';
    prevBtn.disabled = !state.ready || state.currentPage <= 1;
    nextBtn.disabled = !state.ready || state.currentPage >= (state.pdf ? state.pdf.numPages : 0);
}

function scrollToPage(num, smooth = true) {
    const view = state.views[num - 1];
    if (!view) {
        return;
    }

    const target = elementTop(view.el) - 14;
    viewer.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}

function captureAnchor() {
    if (!state.views.length) {
        return null;
    }

    const probe = viewer.scrollTop + viewer.clientHeight / 2;
    let index = 0;
    let ratio = 0;

    for (let i = 0; i < state.views.length; i += 1) {
        const top = elementTop(state.views[i].el);
        const height = state.views[i].el.offsetHeight;

        if (probe >= top && probe < top + height) {
            index = i;
            ratio = (probe - top) / height;
            break;
        }

        if (probe < top) {
            index = i;
            ratio = 0;
            break;
        }

        index = i;
        ratio = 1;
    }

    return {
        index,
        ratio,
        xRatio: state.pageWidth ? (viewer.scrollLeft + viewer.clientWidth / 2) / state.pageWidth : 0.5,
    };
}

function restoreAnchor(anchor) {
    if (!anchor) {
        return;
    }

    const view = state.views[anchor.index];
    if (!view) {
        return;
    }

    const target = elementTop(view.el) + anchor.ratio * view.el.offsetHeight - viewer.clientHeight / 2;
    viewer.scrollTop = Math.max(0, target);
    viewer.scrollLeft = Math.max(0, anchor.xRatio * state.pageWidth - viewer.clientWidth / 2);
}

function applyZoom(nextZoom) {
    if (!state.ready) {
        return;
    }

    const next = clamp(Math.round(nextZoom / ZOOM_STEP) * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
    if (next === state.zoom) {
        return;
    }

    const anchor = captureAnchor();
    state.zoom = next;
    zoomInfoEl.textContent = `${Math.round(state.zoom * 100)}%`;

    layoutPages();
    invalidateViews();
    renderNearby(RENDER_MARGIN);
    restoreAnchor(anchor);
    updateCurrentPage();
}

function onScroll() {
    if (scrollFrame) {
        return;
    }

    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        renderNearby();
        unloadFarPages();
        updateCurrentPage();
    });
}

function onResize() {
    if (!state.ready) {
        return;
    }

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const previousWidth = state.pageWidth;
        const anchor = captureAnchor();
        layoutPages();

        if (state.pageWidth !== previousWidth) {
            invalidateViews();
            renderNearby(RENDER_MARGIN);
            restoreAnchor(anchor);
        }

        updateCurrentPage();
    }, 150);
}

function bindControls() {
    prevBtn.addEventListener('click', () => {
        if (state.ready) {
            scrollToPage(state.currentPage - 1);
        }
    });

    nextBtn.addEventListener('click', () => {
        if (state.ready) {
            scrollToPage(state.currentPage + 1);
        }
    });

    zoomOutBtn.addEventListener('click', () => applyZoom(state.zoom - ZOOM_STEP));
    zoomInBtn.addEventListener('click', () => applyZoom(state.zoom + ZOOM_STEP));
    zoomResetBtn.addEventListener('click', () => applyZoom(1));
}

function setControlsEnabled(enabled) {
    zoomOutBtn.disabled = !enabled;
    zoomInBtn.disabled = !enabled;
    zoomResetBtn.disabled = !enabled;
}

async function init() {
    bindControls();

    try {
        loadingTextEl.textContent = '正在加载 PDF…';

        const loadingTask = pdfjsLib.getDocument({ url: PDF_URL });
        loadingTask.onProgress = ({ loaded, total }) => {
            if (!total) {
                loadingProgressEl.textContent = `${(loaded / 1048576).toFixed(1)} MB`;
                return;
            }
            const percent = Math.min(100, Math.round((loaded / total) * 100));
            loadingProgressEl.textContent = `已加载 ${percent}%`;
        };

        const pdf = await loadingTask.promise;
        state.pdf = pdf;

        await createPages(pdf);
        layoutPages();

        state.ready = true;
        state.currentPage = 1;
        setControlsEnabled(true);
        updatePageInfo();

        viewer.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);

        // 先渲染第一页，再撤掉加载层，避免白屏
        let firstPageRendered = true;
        if (state.views[0]) {
            await renderView(state.views[0]);
            firstPageRendered = state.views[0].el.classList.contains('rendered');
        }

        loadingEl.hidden = true;
        window.__pdfViewerReady = true;

        if (!firstPageRendered) {
            errorEl.hidden = false;
            return;
        }

        errorEl.hidden = true;
        renderNearby(RENDER_MARGIN);
        updateCurrentPage();
    } catch (error) {
        console.error('PDF 加载失败', error);
        loadingEl.hidden = true;
        errorEl.hidden = false;
    }
}

init();
