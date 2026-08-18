/* ===================================================================
   render.js — fetches data/*.json and builds case galleries + tables.
   No dependencies. Runs on plain file:// or any static server.
   =================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-gallery]").forEach((el) => {
    renderGallery(el, el.getAttribute("data-gallery"));
  });
  document.querySelectorAll("[data-table]").forEach((el) => {
    renderTable(el, el.getAttribute("data-table"));
  });

  // Pause videos when the tab is hidden to save resources.
  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll("video").forEach((v) => {
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    });
  });
});

/* --------------------------- helpers --------------------------- */
function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node[k] = v;
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function status(el, msg) {
  el.innerHTML = "";
  el.appendChild(h("div", { class: "gallery-status" }, msg));
}

function resolveUrl(path) {
  // Under a /proxy/<port>/ prefix, serve.py sets window.__PAGE_BASE__.
  const base = window.__PAGE_BASE__;
  if (base && !/^([a-z]+:)?\/\//i.test(path) && !path.startsWith("/")) {
    try { return new URL(path, base).href; } catch (e) { /* fall through */ }
  }
  return path;
}

async function loadJSON(path) {
  const res = await fetch(resolveUrl(path), { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* --------------------------- gallery --------------------------- */
/*
  Expected JSON shape (array of cases):
  [
    {
      "id": "case001",
      "type": "Background Replace",        // optional tag chip
      "instruction": "Change the ...",     // optional
      "note": "extra description",         // optional
      "checklist": ["item 1", "item 2"],   // optional (bench cases)
      "media": [
        { "label": "Input", "video": "assets/videos/x_input.mp4" },
        { "label": "Ours",  "video": "assets/videos/x_ours.mp4", "highlight": true },
        { "label": "Method B", "image": "assets/images/x_b.png" }
      ]
    }
  ]
*/
async function renderGallery(el, path) {
  status(el, "Loading …");
  let cases;
  try {
    cases = await loadJSON(path);
  } catch (err) {
    status(el, `Could not load ${path} (${err.message}). Add cases to that file.`);
    return;
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    status(el, `No cases yet in ${path}. Add entries to populate this gallery.`);
    return;
  }

  el.innerHTML = "";
  cases.forEach((c) => el.appendChild(buildCase(c)));

  // Wire up hover-driven comparison sliders created above.
  initVideoSliders(el);
}

function buildCase(c) {
  const meta = h("div", { class: "case-meta" });

  // tags: accept a string ("Add") or an array (["Multi-Task","Add","Swap"])
  const tags = Array.isArray(c.type) ? c.type : c.type ? [c.type] : [];
  if (tags.length) {
    const tagWrap = h("div", { class: "case-tags" });
    tags.forEach((t, i) =>
      tagWrap.appendChild(
        h("span", { class: "case-tag" + (i === 0 ? " primary" : "") }, String(t))
      )
    );
    meta.appendChild(tagWrap);
  }
  // instruction: string -> one line; array -> numbered list (multi-instruction)
  if (Array.isArray(c.instruction)) {
    const instrs = c.instruction.filter((s) => s != null && String(s).trim() !== "");
    if (instrs.length === 1) {
      meta.appendChild(
        h("div", { class: "case-instruction" }, [
          h("span", { class: "instr-label" }, "Instruction: "),
          String(instrs[0]),
        ])
      );
    } else if (instrs.length > 1) {
      meta.appendChild(h("div", { class: "instr-label" }, "Instructions:"));
      const ol = h("ol", { class: "instr-list" });
      instrs.forEach((s) => ol.appendChild(h("li", {}, String(s))));
      meta.appendChild(ol);
    }
  } else if (c.instruction) {
    meta.appendChild(
      h("div", { class: "case-instruction" }, [
        h("span", { class: "instr-label" }, "Instruction: "),
        c.instruction,
      ])
    );
  }
  if (c.note) meta.appendChild(h("div", { class: "case-note" }, c.note));

  const media = c.media || [];

  // Overlay comparison slider: two videos stacked, hover to reveal.
  const canSlide =
    c.layout === "slider" &&
    media.filter((m) => m.video).length >= 2;

  const body = canSlide ? buildSlider(media) : buildMediaRow(media);

  const card = h("div", { class: "case-card" }, [meta, body]);

  if (Array.isArray(c.checklist) && c.checklist.length) {
    const ul = h("ul", { class: "checklist" });
    c.checklist.forEach((item) => ul.appendChild(h("li", {}, item)));
    card.appendChild(ul);
  }
  return card;
}

/* side-by-side media grid (default layout) */
function buildMediaRow(media) {
  const row = h("div", { class: "media-row" });
  row.style.setProperty("--cols", Math.max(media.length, 1));

  media.forEach((m) => {
    const col = h("div", {
      class: "media-col" + (m.highlight ? " highlight-col" : ""),
    });
    if (m.label) col.appendChild(h("div", { class: "media-label" }, m.label));
    if (m.video) {
      col.appendChild(
        h("video", {
          src: resolveUrl(m.video),
          controls: true,
          autoplay: true,
          loop: true,
          muted: true,
          playsInline: true,
        })
      );
    } else if (m.image) {
      col.appendChild(h("img", { src: resolveUrl(m.image), alt: m.label || "" }));
    }
    row.appendChild(col);
  });
  return row;
}

/* --------------------------- slider ---------------------------- */
/*
  Overlay before/after comparison. Renders the first two video items of
  `media` stacked on top of each other; the "after" (source) is clipped
  and revealed as the cursor moves across the video.

  before = the highlighted video (Edited Target, sits on the left);
  after = the non-highlighted video (Source, clipped on the right).
  Falls back to array order when no highlight flag. Dragging the handle
  right reveals more of the Edited Target (progress metaphor).
*/
function buildSlider(media) {
  const videos = media.filter((m) => m.video);
  let before = videos[0];
  let after = videos[1];
  const hl = videos.find((m) => m.highlight);
  if (hl) {
    before = hl;
    after = videos.find((m) => m !== hl) || videos[0];
  }

  const vid = (m, cls) =>
    h("video", {
      class: cls,
      src: resolveUrl(m.video),
      // Playback is driven by initVideoSliders so the two clips stay
      // frame-aligned; the "before" clip is the master, "after" follows.
      autoplay: cls === "video-before",
      loop: false,
      muted: true,
      playsInline: true,
    });

  // `before` stays in normal flow to give the container its height;
  // `after` is absolutely positioned on top and clipped.
  const slider = h("div", { class: "video-slider" }, [
    vid(before, "video-before"),
    vid(after, "video-after"),
    h("div", { class: "slider-handle" }),
  ]);

  // corner labels
  if (before.label)
    slider.appendChild(h("div", { class: "slider-label before" }, before.label));
  if (after.label)
    slider.appendChild(h("div", { class: "slider-label after" }, after.label));

  // zoom button -> opens modal with the same slider
  const zoomBtn = h("button", {
    class: "slider-zoom-btn",
    title: "放大查看",
    onclick: (e) => {
      e.stopPropagation();
      openSliderModal(media);
    },
  }, "⤢");
  slider.appendChild(zoomBtn);

  return slider;
}

/* ─── Modal: enlarged slider view ─── */
// Track videos that were playing before opening the modal, so we can resume them on close.
let _pausedByModal = [];

function openSliderModal(media) {
  // Pause all inline videos to save resources; remember which were playing.
  _pausedByModal = [];
  document.querySelectorAll("video").forEach((v) => {
    if (!v.paused) {
      _pausedByModal.push(v);
      v.pause();
    }
  });

  const overlay = h("div", { class: "video-modal", onclick: closeModal });
  const closeBtn = h("button", {
    class: "modal-close-btn",
    title: "关闭",
    onclick: closeModal,
  }, "✕");
  const modalContent = h("div", {
    class: "modal-slider-wrap",
    onclick: (e) => e.stopPropagation(),
  });

  // Reuse buildSlider to create the same interactive slider
  const sliderEl = buildSliderRaw(media);
  modalContent.appendChild(sliderEl);

  overlay.appendChild(modalContent);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  // Wire up slider interactions for the modal
  initVideoSliders(overlay);

  // ESC to close
  const onKey = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
}

function closeModal() {
  const overlay = document.querySelector(".video-modal");
  if (!overlay) return;
  // Pause modal videos before removing
  overlay.querySelectorAll("video").forEach((v) => v.pause());
  overlay.remove();
  document.body.style.overflow = "";
  // Resume videos that were playing before the modal opened.
  _pausedByModal.forEach((v) => {
    if (v.isConnected) v.play().catch(() => {});
  });
  _pausedByModal = [];
}

// buildSlider without the zoom button (avoids infinite recursion in modal)
function buildSliderRaw(media) {
  const videos = media.filter((m) => m.video);
  let before = videos[0];
  let after = videos[1];
  const hl = videos.find((m) => m.highlight);
  if (hl) {
    before = hl;
    after = videos.find((m) => m !== hl) || videos[0];
  }

  const vid = (m, cls) =>
    h("video", {
      class: cls,
      src: resolveUrl(m.video),
      autoplay: cls === "video-before",
      loop: false,
      muted: true,
      playsInline: true,
    });

  const slider = h("div", { class: "video-slider" }, [
    vid(before, "video-before"),
    vid(after, "video-after"),
    h("div", { class: "slider-handle" }),
  ]);

  if (before.label)
    slider.appendChild(h("div", { class: "slider-label before" }, before.label));
  if (after.label)
    slider.appendChild(h("div", { class: "slider-label after" }, after.label));

  return slider;
}

/* Bind hover / touch interaction to every .video-slider under `root`. */
function initVideoSliders(root) {
  root.querySelectorAll(".video-slider").forEach((slider) => {
    if (slider.dataset.sliderReady) return;
    slider.dataset.sliderReady = "1";

    const before = slider.querySelector(".video-before");
    const after = slider.querySelector(".video-after");
    const handle = slider.querySelector(".slider-handle");
    const labelBefore = slider.querySelector(".slider-label.before");
    const labelAfter = slider.querySelector(".slider-label.after");

    // Keep the two clips frame-aligned: `before` is the master clock,
    // `after` mirrors its currentTime, and both loop back together. This
    // avoids the drift you get from two independently-looping <video>s.
    if (before && after) {
      const startTogether = () => {
        before.currentTime = 0;
        after.currentTime = 0;
        before.play().catch(() => {});
        after.play().catch(() => {});
      };

      // When the master reaches the end, restart the pair in unison.
      before.addEventListener("ended", startTogether);

      // Correct drift periodically off the master's clock. `timeupdate`
      // fires only a few times per second, so only reseat `after` when it
      // has drifted noticeably — small offsets are imperceptible and
      // constant seeking would cause visible stutter.
      before.addEventListener("timeupdate", () => {
        if (Math.abs(after.currentTime - before.currentTime) > 0.1) {
          after.currentTime = before.currentTime;
        }
      });

      // Kick off once both have enough data to seek reliably.
      if (before.readyState >= 1 && after.readyState >= 1) startTogether();
      else {
        let ready = 0;
        const onReady = () => {
          if (++ready === 2) startTogether();
        };
        before.addEventListener("loadedmetadata", onReady, { once: true });
        after.addEventListener("loadedmetadata", onReady, { once: true });
      }
    }
    let rect = null;
    let raf = null;

    const apply = (p) => {
      const pct = Math.max(0, Math.min(100, p * 100));
      after.style.clipPath = `inset(0 0 0 ${pct}%)`;
      handle.style.left = `${pct}%`;
      // Fade each label with its visible region: the Edited Target
      // (before) sits left of the handle, the Source (after) right of it
      // — as one side is covered up, its label fades out so only the
      // surviving region's label stays.
      if (labelBefore) labelBefore.style.opacity = p;
      if (labelAfter) labelAfter.style.opacity = 1 - p;
    };
    apply(0.5); // default: split down the middle

    const progressFromX = (x) =>
      rect ? (x - rect.left) / rect.width : 0.5;

    const onMove = (clientX) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => apply(progressFromX(clientX)));
    };

    // Desktop: follow the cursor on hover.
    slider.addEventListener("mouseenter", () => {
      rect = slider.getBoundingClientRect();
      slider.classList.add("is-active");
    });
    slider.addEventListener("mousemove", (e) => onMove(e.clientX));
    slider.addEventListener("mouseleave", () => {
      if (raf) cancelAnimationFrame(raf);
      slider.classList.remove("is-active");
      apply(0.5); // spring back to the middle
    });

    // Mobile: drag to reveal.
    slider.addEventListener(
      "touchstart",
      (e) => {
        rect = slider.getBoundingClientRect();
        slider.classList.add("is-active");
        apply(progressFromX(e.touches[0].clientX));
      },
      { passive: true }
    );
    slider.addEventListener(
      "touchmove",
      (e) => {
        apply(progressFromX(e.touches[0].clientX));
        e.preventDefault();
      },
      { passive: false }
    );
    slider.addEventListener("touchend", () => {
      slider.classList.remove("is-active");
    });
  });
}

/* --------------------------- table ----------------------------- */
/*
  Expected JSON shape:
  {
    "columns": ["Method", "Params", "Metric A", "Metric B"],
    "highlightBest": true,          // optional: bold max per numeric col
    "rows": [
      { "cells": ["Method X", "2B", 0.71, 0.65] },
      { "cells": ["Ours", "2B", 0.83, 0.79], "ours": true }
    ]
  }
*/
async function renderTable(el, path) {
  status(el, "Loading …");
  let data;
  try {
    data = await loadJSON(path);
  } catch (err) {
    status(el, `Could not load ${path} (${err.message}).`);
    return;
  }
  const cols = data.columns || [];
  const rows = data.rows || [];
  if (!cols.length || !rows.length) {
    status(el, `No table data yet in ${path}.`);
    return;
  }

  // compute best (max) per numeric column if requested
  let bestIdx = {};
  if (data.highlightBest) {
    for (let c = 1; c < cols.length; c++) {
      let best = -Infinity, idx = -1;
      rows.forEach((r, ri) => {
        if (r.baseline) return; // skip baseline (reference) rows
        const v = Number(r.cells[c]);
        if (!Number.isNaN(v) && v > best) { best = v; idx = ri; }
      });
      if (idx >= 0) bestIdx[c] = idx;
    }
  }

  const thead = h("thead", {}, [
    h("tr", {}, cols.map((c) => h("th", {}, String(c)))),
  ]);
  const tbody = h("tbody", {},
    rows.map((r, ri) =>
      h("tr", { class: (r.ours ? "is-ours " : "") + (r.baseline ? "is-baseline" : "") },
        r.cells.map((cell, ci) =>
          h("td", {
            class:
              (ci === 0 ? "method-name" : "") +
              (bestIdx[ci] === ri ? " best" : ""),
          }, String(cell))
        )
      )
    )
  );

  el.innerHTML = "";
  el.appendChild(h("table", { class: "metrics" }, [thead, tbody]));
}
