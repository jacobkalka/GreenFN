// GreenFN entry point.
import { App } from './app.js';

const app = new App(document.getElementById('game'), document.getElementById('ui'));
window.__gfn = app; // debug / automated test hook
app.start();
