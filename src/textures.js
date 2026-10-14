import * as THREE from 'three';

const cache = new Map();

function canvasTex(key, w, h, draw, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  cache.set(key, t);
  return t;
}

const FONT = '"Anton", "Impact", "Arial Black", sans-serif';

export function roadTexture(theme) {
  return canvasTex('road-' + theme.base, 512, 512, (g, w, h) => {
    g.fillStyle = theme.base; g.fillRect(0, 0, w, h);
    // asphalt grain
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // lane dividers (dashed) at 1/3 and 2/3
    g.fillStyle = theme.line;
    for (const x of [w / 3, (2 * w) / 3]) {
      for (let y = 0; y < h; y += 128) g.fillRect(x - 4, y, 8, 70);
    }
    // glowing edges
    g.fillStyle = theme.edge;
    g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
    // coin-ish markings like the golden road in the capture
    g.globalAlpha = 0.12; g.fillStyle = theme.line;
    for (let y = 40; y < h; y += 128) { g.beginPath(); g.arc(w / 2, y, 20, 0, 7); g.fill(); }
  }, { repeat: true });
}

export function windowsTexture(key, cols, density) {
  return canvasTex('win-' + key, 128, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) {
      if (Math.random() < density) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = 0.4 + Math.random() * 0.6;
        g.fillRect(x, y, 8, 10);
      }
    }
  }, { repeat: true });
}

export function signTexture(text, color) {
  const hex = '#' + color.toString(16).padStart(6, '0');
  return canvasTex('sign-' + text + hex, 512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(10,5,25,0.85)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = hex; g.lineWidth = 10; g.shadowColor = hex; g.shadowBlur = 25;
    g.strokeRect(12, 12, w - 24, h - 24);
    const lines = text.split('\n');
    const size = lines.length > 1 ? 72 : (text.length > 9 ? 78 : 120);
    g.font = `${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
    g.shadowBlur = 0; g.globalAlpha = 0.6; g.fillStyle = hex;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
  });
}

export function labelTexture(text, bg, fg = '#fff', w = 256, h = 128, size = 56) {
  return canvasTex(`label-${text}-${bg}-${fg}-${w}`, w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = `${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = fg;
    text.split('\n').forEach((l, i, a) => g.fillText(l, w / 2, h / 2 + (i - (a.length - 1) / 2) * size * 1.05));
  });
}

export function coinTexture() {
  return canvasTex('coin', 256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#fff3a8'); grd.addColorStop(0.6, '#ffc21a'); grd.addColorStop(1, '#b87400');
    g.fillStyle = grd; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 7); g.fill();
    g.strokeStyle = '#8a5500'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 22, 0, 7); g.stroke();
    g.fillStyle = '#7a4a00'; g.font = `92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('$HB', w / 2, h / 2 + 6);
  });
}

export function skyTexture(top, bottom) {
  return canvasTex('sky-' + top + bottom, 16, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function glowTexture() {
  return canvasTex('glow', 128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- character textures
// Raccoon head, painted on an equirectangular sphere UV. Face centre is u=0.75 (−z), eye line v≈0.47.
export function raccoonFaceTexture() {
  return canvasTex('raccoon-face', 512, 256, (g, w, h) => {
    const cx = w * 0.75;
    g.fillStyle = '#8f8f9c'; g.fillRect(0, 0, w, h);
    // soft fur variation
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 5);
    }
    // darker back of head + forehead stripe
    g.fillStyle = 'rgba(40,40,52,0.35)'; g.fillRect(0, 0, w * 0.5, h * 0.6);
    g.fillStyle = '#4b4b58';
    g.beginPath(); g.ellipse(cx, h * 0.26, 10, 46, 0, 0, Math.PI * 2); g.fill();
    // white brows
    g.fillStyle = '#f4f2ef';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 34, h * 0.36, 30, 11, s * 0.25, 0, Math.PI * 2); g.fill(); }
    // bandit mask: band across the eyes drooping toward the cheeks
    g.fillStyle = '#16161c';
    g.beginPath();
    g.moveTo(cx - 92, h * 0.53);
    g.bezierCurveTo(cx - 80, h * 0.38, cx - 30, h * 0.40, cx, h * 0.45);
    g.bezierCurveTo(cx + 30, h * 0.40, cx + 80, h * 0.38, cx + 92, h * 0.53);
    g.bezierCurveTo(cx + 84, h * 0.66, cx + 52, h * 0.62, cx + 26, h * 0.57);
    g.bezierCurveTo(cx + 10, h * 0.54, cx - 10, h * 0.54, cx - 26, h * 0.57);
    g.bezierCurveTo(cx - 52, h * 0.62, cx - 84, h * 0.66, cx - 92, h * 0.53);
    g.fill();
    // white muzzle / cheeks
    g.fillStyle = '#f4f2ef';
    g.beginPath(); g.ellipse(cx, h * 0.68, 44, 26, 0, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 70, h * 0.66, 26, 14, -s * 0.5, 0, Math.PI * 2); g.fill(); }
  });
}

export function fabricTexture(base, key) {
  return canvasTex('fabric-' + key + base, 128, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.03})`; g.fillRect(0, y, w, 1); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  }, { repeat: true });
}

export function pinstripeTexture() {
  return canvasTex('pinstripe', 128, 128, (g, w, h) => {
    g.fillStyle = '#4a238f'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(200,170,255,0.35)';
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
  }, { repeat: true });
}

export function patchTexture(text, bg, fg) {
  return canvasTex(`patch-${text}-${bg}`, 128, 128, (g, w, h) => {
    g.fillStyle = bg; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); g.fill();
    g.strokeStyle = fg; g.lineWidth = 6; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 12, 0, 7); g.stroke();
    g.fillStyle = fg; g.font = `${text.length > 3 ? 34 : 46}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

export function bandanaTexture() {
  return canvasTex('bandana', 64, 64, (g, w, h) => {
    g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    for (let y = 4; y < h; y += 12) for (let x = (y / 12) % 2 ? 4 : 10; x < w; x += 12) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
  });
}

// ---------------------------------------------------------------- obstacle textures
export function hazardTexture(text, a = '#ff2d55', b = '#ffffff') {
  return canvasTex('hazard-' + text + a, 512, 128, (g, w, h) => {
    g.fillStyle = b; g.fillRect(0, 0, w, h);
    g.fillStyle = a;
    for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 - h, h); g.lineTo(x - h, h); g.fill(); }
    if (text) {
      g.fillStyle = '#14002a'; g.fillRect(w / 2 - 110, 10, 220, h - 20);
      g.fillStyle = '#fff'; g.font = `84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    }
  });
}

export function crateTexture(label, color) {
  return canvasTex('crate-' + label + color, 256, 256, (g, w, h) => {
    g.fillStyle = '#9a6a35'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { g.fillStyle = y % 64 ? '#8a5c2c' : '#a87640'; g.fillRect(0, y, w, 30); }
    g.strokeStyle = '#5a3a18'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
    if (label) {
      g.fillStyle = 'rgba(20,0,40,0.85)'; g.fillRect(20, h / 2 - 58, w - 40, 116);
      g.fillStyle = color; g.font = `64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      label.split('\n').forEach((l, i, a) => g.fillText(l, w / 2, h / 2 + (i - (a.length - 1) / 2) * 58));
    }
  });
}

export function rugTexture() {
  return canvasTex('rug', 256, 512, (g, w, h) => {
    g.fillStyle = '#9e1030'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd23c'; g.lineWidth = 12; g.strokeRect(14, 14, w - 28, h - 28);
    g.strokeStyle = '#2a0a4a'; g.lineWidth = 6; g.strokeRect(34, 34, w - 68, h - 68);
    g.fillStyle = '#ffd23c';
    for (let y = 90; y < h - 60; y += 110) {
      g.save(); g.translate(w / 2, y); g.rotate(Math.PI / 4); g.fillRect(-30, -30, 60, 60);
      g.fillStyle = '#9e1030'; g.fillRect(-16, -16, 32, 32); g.fillStyle = '#ffd23c'; g.restore();
    }
  });
}

export function pitTexture() {
  return canvasTex('pit', 64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ff2d55'); grd.addColorStop(0.15, '#3a0010'); grd.addColorStop(1, '#000');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- world textures
export function sidewalkTexture(base, accent) {
  return canvasTex('walk-' + base, 128, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = accent; g.globalAlpha = 0.5; g.fillRect(0, 0, 6, h);
  }, { repeat: true });
}

export function storefrontTexture(name, color) {
  return canvasTex('shop-' + name + color, 256, 128, (g, w, h) => {
    g.fillStyle = '#120a1e'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 40, 0, h);
    grd.addColorStop(0, '#ffcf8a'); grd.addColorStop(1, '#ff7a3c');
    g.fillStyle = grd; g.globalAlpha = 0.8; g.fillRect(14, 44, w - 28, h - 54); g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.5)'; for (let x = 14; x < w - 14; x += 38) g.fillRect(x, 44, 4, h - 54);
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 12;
    g.font = `34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, 22);
  });
}

// distant skyline backdrop (not fogged): silhouettes + lit windows + optional moon / glow
export function skylineTexture(id, top, bottom, building, windows, extra) {
  return canvasTex('skyline-' + id, 1024, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    if (extra === 'moon') {
      const m = g.createRadialGradient(780, 120, 10, 780, 120, 140);
      m.addColorStop(0, 'rgba(255,240,200,1)'); m.addColorStop(0.35, 'rgba(255,220,170,0.9)'); m.addColorStop(0.4, 'rgba(255,200,255,0.25)'); m.addColorStop(1, 'rgba(255,120,255,0)');
      g.fillStyle = m; g.fillRect(600, 0, 360, 300);
    } else if (extra === 'gold') {
      const m = g.createRadialGradient(w / 2, h * 0.75, 20, w / 2, h * 0.75, 500);
      m.addColorStop(0, 'rgba(255,210,80,0.85)'); m.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = m; g.fillRect(0, 0, w, h);
    } else if (extra === 'red') {
      g.strokeStyle = 'rgba(255,40,60,0.55)'; g.lineWidth = 5; g.beginPath();
      let y = 120; g.moveTo(0, y);
      for (let x = 0; x < w; x += 40) { y += (Math.random() - 0.35) * 40; g.lineTo(x, Math.min(h * 0.7, y)); }
      g.stroke();
    }
    for (let layer = 0; layer < 2; layer++) {
      let x = 0;
      while (x < w) {
        const bw = 30 + Math.random() * 70, bh = (layer ? 120 : 70) + Math.random() * (layer ? 220 : 160);
        g.fillStyle = layer ? building : 'rgba(0,0,0,0.35)';
        g.fillRect(x, h - bh, bw, bh);
        if (layer) {
          for (let wy = h - bh + 8; wy < h - 6; wy += 10) for (let wx = x + 5; wx < x + bw - 5; wx += 8) {
            if (Math.random() < 0.28) { g.fillStyle = windows[(Math.random() * windows.length) | 0]; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(wx, wy, 3, 4); g.globalAlpha = 1; }
          }
          if (Math.random() < 0.25) { g.fillStyle = building; g.fillRect(x + bw / 2 - 2, h - bh - 30, 4, 30); }
        }
        x += bw + (layer ? 4 : -10) + Math.random() * 12;
      }
    }
  });
}

export function sparkleTexture() {
  return canvasTex('sparkle', 64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,240,180,0.8)'); grd.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 + 3, h / 2); g.lineTo(w / 2, h); g.lineTo(w / 2 - 3, h / 2); g.fill();
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w / 2, h / 2 - 3); g.lineTo(w, h / 2); g.lineTo(w / 2, h / 2 + 3); g.fill();
  });
}

export function trailTexture() {
  return canvasTex('trail', 16, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
