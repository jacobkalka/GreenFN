// GreenFN entry point.
import { App } from './app.js';

const loading = document.getElementById('loading');

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (e) {
    return false;
  }
}

function fail(msg) {
  if (loading) loading.classList.add('done');
  const d = document.createElement('div');
  d.className = 'webgl-error';
  d.innerHTML = `<div><div style="font-family:var(--display);font-weight:800;font-size:40px;color:#eef3f8;letter-spacing:.06em">GREEN<span style="color:#2ad4ff">FN</span></div><p>${msg}</p></div>`;
  document.body.appendChild(d);
}

if (!webglOk()) {
  fail('This game needs WebGL 2. Please use a recent desktop browser (Chrome, Edge, Firefox or Safari) with hardware acceleration enabled.');
} else {
  // fonts first so canvas-drawn jersey numbers / wordmarks use the right typeface
  const fontsReady = document.fonts ? Promise.race([document.fonts.load('800 40px "Barlow Condensed"'), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(() => {
    try {
      const app = new App(document.getElementById('game'), document.getElementById('ui'));
      window.__gfn = app; // debug / automated test hook
      app.start();
      requestAnimationFrame(() => requestAnimationFrame(() => loading && loading.classList.add('done')));
    } catch (e) {
      console.error(e);
      fail('Something went wrong while starting the game: ' + (e && e.message ? e.message : e));
    }
  });
}
