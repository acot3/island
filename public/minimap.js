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

    mountEl.innerHTML = '';
    mountEl.appendChild(svg);
  }

  function initMinimap(socket, mountEl) {
    socket.on('map-state', (state) => {
      render(state, mountEl);
      mountEl.classList.remove('hidden');
    });
  }

  window.initMinimap = initMinimap;
})();
