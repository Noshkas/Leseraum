export function createCarousel({ className, onCommit }) {
  const container = document.createElement("div");
  container.className = `carousel ${className}`;

  const SNAP_TOLERANCE_PX = 0.5;
  const SETTLE_DELAY_MS = 130;
  const PROGRAMMATIC_COMMIT_SUPPRESS_MS = 260;

  let items = [];
  let metrics = [];
  let itemByValue = new Map();
  let settleTimer = 0;
  let styleRaf = 0;
  let recalcRaf = 0;
  let startSpacerEl = null;
  let endSpacerEl = null;
  let suppressCommitUntil = 0;
  let recenterTimer = 0;

  function updateSpacerWidths() {
    if (!startSpacerEl || !endSpacerEl || !items.length) return;
    if (container.clientWidth <= 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const startWidth = Math.max(0, container.clientWidth / 2 - first.offsetWidth / 2);
    const endWidth = Math.max(0, container.clientWidth / 2 - last.offsetWidth / 2);

    startSpacerEl.style.width = `${startWidth}px`;
    endSpacerEl.style.width = `${endWidth}px`;
  }

  function recalcMetrics() {
    updateSpacerWidths();
    metrics = items.map((item) => ({
      value: item.dataset.value,
      node: item,
    }));
  }

  function getClosestMetric() {
    if (!metrics.length) return null;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    if (containerRect.width <= 0) return null;

    let closest = null;
    let minDist = Infinity;

    for (const metric of metrics) {
      const rect = metric.node.getBoundingClientRect();
      const metricCenter = rect.left + rect.width / 2;
      const dist = Math.abs(metricCenter - containerCenter);
      if (dist < minDist) {
        minDist = dist;
        closest = metric;
      }
    }

    return closest;
  }

  function getTargetLeftForNode(node) {
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    const nodeCenter = nodeRect.left + nodeRect.width / 2;
    const raw = container.scrollLeft + (nodeCenter - containerCenter);
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    return Math.max(0, Math.min(maxLeft, raw));
  }

  function getTargetLeft(metric) {
    return getTargetLeftForNode(metric.node);
  }

  function applyStyles() {
    const closest = getClosestMetric();
    const activeValue = closest?.value ?? null;

    for (const metric of metrics) {
      if (metric.value === activeValue) {
        metric.node.classList.add("active");
      } else {
        metric.node.classList.remove("active");
      }
    }
  }

  function scheduleStyle() {
    if (styleRaf) return;
    styleRaf = requestAnimationFrame(() => {
      styleRaf = 0;
      applyStyles();
    });
  }

  function scheduleRecalc() {
    if (recalcRaf) return;
    recalcRaf = requestAnimationFrame(() => {
      recalcRaf = 0;
      recalcMetrics();
      scheduleStyle();
    });
  }

  function commitClosest(metric = getClosestMetric()) {
    if (!metric) return;
    onCommit(metric.value);
  }

  function snapToClosest(behavior = "smooth") {
    const closest = getClosestMetric();
    if (!closest) return null;

    const targetLeft = getTargetLeft(closest);
    if (Math.abs(container.scrollLeft - targetLeft) > SNAP_TOLERANCE_PX) {
      container.scrollTo({ left: targetLeft, behavior });
    }

    return closest;
  }

  function scrollToValue(value, behavior = "auto", { suppressCommit = true } = {}) {
    const item = itemByValue.get(String(value));
    if (!item) return;

    if (suppressCommit) {
      suppressCommitUntil = performance.now() + PROGRAMMATIC_COMMIT_SUPPRESS_MS;
    }

    recalcMetrics();
    const targetLeft = getTargetLeftForNode(item);

    container.scrollTo({ left: targetLeft, behavior });
    scheduleStyle();

    clearTimeout(recenterTimer);
    recenterTimer = window.setTimeout(() => {
      const retryTargetLeft = getTargetLeftForNode(item);
      if (Math.abs(container.scrollLeft - retryTargetLeft) > SNAP_TOLERANCE_PX) {
        container.scrollTo({ left: retryTargetLeft, behavior: "auto" });
      }
      scheduleStyle();
    }, 45);
  }

  function setItems(nextItems) {
    clearTimeout(settleTimer);
    items = [];
    metrics = [];
    itemByValue = new Map();
    startSpacerEl = null;
    endSpacerEl = null;
    suppressCommitUntil = performance.now() + PROGRAMMATIC_COMMIT_SUPPRESS_MS;
    clearTimeout(recenterTimer);

    container.innerHTML = "";

    startSpacerEl = document.createElement("div");
    startSpacerEl.className = "carousel-spacer";
    container.appendChild(startSpacerEl);

    for (const itemData of nextItems) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "carousel-item";
      btn.textContent = itemData.label;
      btn.dataset.value = String(itemData.value);

      items.push(btn);
      itemByValue.set(btn.dataset.value, btn);
      container.appendChild(btn);
    }

    endSpacerEl = document.createElement("div");
    endSpacerEl.className = "carousel-spacer";
    container.appendChild(endSpacerEl);

    scheduleRecalc();
    setTimeout(scheduleRecalc, 120);
  }

  function refreshMetrics() {
    scheduleRecalc();
  }

  function settleSelection() {
    const closest = snapToClosest("auto");
    if (performance.now() < suppressCommitUntil) {
      scheduleStyle();
      return;
    }
    commitClosest(closest);
  }

  function scheduleSettle(delay = SETTLE_DELAY_MS) {
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settleSelection, delay);
  }

  container.addEventListener("click", (event) => {
    const item = event.target.closest(".carousel-item");
    if (!item) return;

    clearTimeout(settleTimer);
    const value = item.dataset.value;
    scrollToValue(value, "auto", { suppressCommit: true });
    onCommit(value);
  });

  container.addEventListener(
    "scroll",
    () => {
      scheduleStyle();
      scheduleSettle();
    },
    { passive: true },
  );

  container.addEventListener("scrollend", () => {
    scheduleSettle(60);
  });

  return {
    el: container,
    setItems,
    scrollToValue,
    refreshMetrics,
  };
}
