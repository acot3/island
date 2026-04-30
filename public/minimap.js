// ============================================================
// Minimap — host-side map widget.
//
// Self-contained: subscribes to `map-state` events on the given socket
// and renders an SVG into the given mount element. Hides itself when
// no map data has arrived yet.
// ============================================================

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function render(state, mountEl) {
    const nodeById = Object.fromEntries(state.nodes.map(n => [n.id, n]));

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-4.8 -4.8 9.6 9.6');

    // Edges first so nodes layer on top
    for (const e of state.edges) {
      const a = nodeById[e.from];
      const b = nodeById[e.to];
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', 'map-edge');
      svg.appendChild(line);
    }

    // Nodes
    for (const n of state.nodes) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', n.x);
      c.setAttribute('cy', n.y);
      c.setAttribute('r', '0.25');
      c.setAttribute('class', `map-node biome-${n.biome}`);
      c.setAttribute('data-id', n.id);
      svg.appendChild(c);
    }

    // Player rings — one ring per node, divided into equal arcs (donut style).
    // Trick: each segment is a full circle with a stroke-dasharray that exposes
    // only its slice, offset to start where the previous segment ends.
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
        // Rotate so segment 0 starts at 12 o'clock and the donut grows clockwise.
        ring.setAttribute('transform', `rotate(-90 ${n.x} ${n.y})`);
        ring.setAttribute('class', 'map-player-ring');
        svg.appendChild(ring);
      });
    }

    mountEl.innerHTML = '';
    mountEl.appendChild(svg);
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
