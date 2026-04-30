// ============================================================
// Minimap — host-side map widget.
//
// Self-contained: subscribes to `map-state` events on the given socket
// and renders an SVG into the given mount element. Hides itself when
// no map data has arrived yet.
//
// The SVG element is persisted across renders so the viewBox can be
// smoothly interpolated when the visible region changes (fog reveal).
// ============================================================

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEWBOX_TRANSITION_MS = 400;

  let svgEl = null;     // persistent across renders
  let liveVB = null;    // last applied viewBox, updated each animation frame
  let animFrame = null; // active rAF, if any

  function ensureSvg(mountEl) {
    if (svgEl && svgEl.parentNode === mountEl) return svgEl;
    svgEl = document.createElementNS(SVG_NS, 'svg');
    mountEl.innerHTML = '';
    mountEl.appendChild(svgEl);
    liveVB = null;
    return svgEl;
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function lerp4(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
    ];
  }

  function applyViewBox(svg, vb) {
    svg.setAttribute('viewBox', vb.join(' '));
    liveVB = vb;
  }

  function animateViewBox(svg, from, to) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / VIEWBOX_TRANSITION_MS);
      applyViewBox(svg, lerp4(from, to, easeInOut(t)));
      if (t < 1) animFrame = requestAnimationFrame(step);
      else animFrame = null;
    }
    animFrame = requestAnimationFrame(step);
  }

  function render(state, mountEl) {
    const svg = ensureSvg(mountEl);
    clearChildren(svg);

    const nodeById = Object.fromEntries(state.nodes.map(n => [n.id, n]));

    // Edges first so nodes draw on top
    for (const e of state.edges) {
      const a = nodeById[e.from];
      const b = nodeById[e.to];
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      // server-supplied kind: 'visited' (white) or 'partial' (grey, the default)
      line.setAttribute('class', `map-edge ${e.kind || 'partial'}`);
      svg.appendChild(line);
    }

    // Nodes — visited fully colored, adjacent-only dimmed via .unvisited class
    for (const n of state.nodes) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', n.x);
      c.setAttribute('cy', n.y);
      c.setAttribute('r', '0.25');
      const dim = n.visited ? '' : ' unvisited';
      c.setAttribute('class', `map-node biome-${n.biome}${dim}`);
      c.setAttribute('data-id', n.id);
      svg.appendChild(c);
    }

    // Player rings — donut-style segments at each occupied node
    const playersByNode = {};
    for (const p of state.players || []) {
      if (!p.nodeId) continue;
      (playersByNode[p.nodeId] = playersByNode[p.nodeId] || []).push(p);
    }
    for (const [nodeId, players] of Object.entries(playersByNode)) {
      const n = nodeById[nodeId];
      if (!n) continue;
      const r = 0.4;
      const C = 2 * Math.PI * r;
      const segLen = C / players.length;
      players.forEach((p, i) => {
        const ring = document.createElementNS(SVG_NS, 'circle');
        ring.setAttribute('cx', n.x);
        ring.setAttribute('cy', n.y);
        ring.setAttribute('r', String(r));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', p.color);
        ring.setAttribute('stroke-width', '0.08');
        ring.setAttribute('stroke-dasharray', `${segLen} ${C - segLen}`);
        ring.setAttribute('stroke-dashoffset', String(-i * segLen));
        ring.setAttribute('transform', `rotate(-90 ${n.x} ${n.y})`);
        ring.setAttribute('class', 'map-player-ring');
        svg.appendChild(ring);
      });
    }

    // ViewBox — snap on first render, animate on subsequent changes
    const target = state.viewBox || [-4.8, -4.8, 9.6, 9.6];
    if (!liveVB) {
      applyViewBox(svg, target.slice());
    } else {
      const changed = target.some((v, i) => Math.abs(v - liveVB[i]) > 0.001);
      if (changed) animateViewBox(svg, liveVB.slice(), target.slice());
    }
  }

  function renderPlayerLegend(state, el) {
    const players = state.players || [];
    el.innerHTML = players.map(p => `
      <div class="legend-item">
        <span class="legend-ring" style="color: ${p.color}"></span>
        <span>${escapeHtml(p.name)}</span>
      </div>
    `).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function initMinimap(socket, mountEl) {
    socket.on('map-state', (state) => {
      render(state, mountEl);
      const overlay = mountEl.closest('#map-overlay') || mountEl;
      const legendPlayersEl = overlay.querySelector('#legend-players');
      if (legendPlayersEl) renderPlayerLegend(state, legendPlayersEl);
      overlay.classList.remove('hidden');
    });
  }

  window.initMinimap = initMinimap;
})();
