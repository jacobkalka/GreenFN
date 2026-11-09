// Broadcast-quality follow camera. Always frames the action toward the active basket from the
// half-court side: behind the user's player on offense, behind the ball handler on defense.
import * as THREE from 'three';
import { HOOP, COURT } from '../sim/constants.js';
import { Spring3, clamp, lerp, damp, smoothstep } from '../core/math.js';
import { BallState } from '../sim/ball.js';

export const CAMERA_PRESETS = {
  iso: { name: 'Iso', height: 6.2, dist: 5.5, lookUp: 0.9, lookAhead: 0.45, fov: 50, yawLimit: 0.5, yawFollow: 0.55 },
  close: { name: 'Close', height: 3.3, dist: 4.4, lookUp: 1.6, lookAhead: 0.45, fov: 55, yawLimit: 0.9, yawFollow: 0.85 },
  high: { name: 'High', height: 8.6, dist: 7.2, lookUp: 0.6, lookAhead: 0.32, fov: 46, yawLimit: 0.35, yawFollow: 0.45 },
  broadcast: { name: 'Broadcast', side: true, height: 6.5, dist: 13.5, lookUp: 1.0, lookAhead: 0.2, fov: 40 },
};

const _focus = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.posSpring = new Spring3(1.25, 1);
    this.lookSpring = new Spring3(1.6, 1);
    this.preset = 'iso';
    this.settings = { distance: 1, height: 1, fov: 0, smoothing: 1, shake: true };
    this.orbitYaw = 0; // user-controlled offset (mouse drag)
    this.orbitHold = 0;
    this.zoomPulse = 0;
    this.fovOffset = 0;
    this.shake = 0;
    this.mode = 'game'; // 'game' | 'menu' | 'locker'
    this.menuT = 0;
    this.initialized = false;
    this.yaw = 0;
    this.lastFocus = new THREE.Vector3(0, 0, 7);
  }

  setPreset(id) {
    if (CAMERA_PRESETS[id]) this.preset = id;
  }

  snap() {
    this.initialized = false;
  }

  /** Mouse-drag orbit input (radians). */
  addOrbit(dYaw) {
    this.orbitYaw = clamp(this.orbitYaw + dYaw, -0.9, 0.9);
    this.orbitHold = 1.2;
  }

  /** Short punch-in (made shots, dunks). */
  pulse(amount = 1) {
    this.zoomPulse = Math.min(1.5, this.zoomPulse + amount);
  }

  addShake(a) {
    if (this.settings.shake) this.shake = Math.min(1, this.shake + a);
  }

  /** Current horizontal camera yaw (for camera-relative controls). */
  getYaw() {
    return this.yaw;
  }

  update(dt, game, user, interpAlpha = 1) {
    const cam = this.camera;
    if (this.mode === 'free') {
      // debug / test: follow a fixed offset from the user; controls stay rim-relative
      this.yaw = Math.PI;
      if (this.freeOffset) {
        cam.position.set(user.pos.x + this.freeOffset.x, this.freeOffset.y, user.pos.z + this.freeOffset.z);
        cam.lookAt(user.pos.x, this.freeLookY || 1.0, user.pos.z);
      }
      return;
    }
    if (this.mode === 'menu' || this.mode === 'locker') return this._updateShowcase(dt, user);
    const P = CAMERA_PRESETS[this.preset];
    const S = this.settings;
    const ball = game.ball;
    const opp = game.opponentOf(user);
    // ---------------- focus point
    let handler = null;
    if (ball.owner && (ball.state === BallState.DRIBBLE || ball.state === BallState.HELD)) handler = ball.owner;
    if (handler === user || !handler || !opp) {
      _focus.set(user.pos.x, 0, user.pos.z);
      _focus.x += user.vel.x * 0.25;
      _focus.z += user.vel.z * 0.25;
      if (!handler && ball.state === BallState.FREE) {
        // loose ball / shot: keep the ball in frame
        _tmp.set(ball.pos.x, 0, ball.pos.z);
        _focus.lerp(_tmp, 0.35);
      }
    } else {
      // defense: frame the ball handler and the user together, biased toward the handler
      _focus.set(handler.pos.x * 0.62 + user.pos.x * 0.38, 0, handler.pos.z * 0.62 + user.pos.z * 0.38);
    }
    // keep the focus on the half court
    _focus.z = clamp(_focus.z, COURT.baselineZ + 2.0, COURT.halfCourtZ + 1);
    _focus.x = clamp(_focus.x, -COURT.halfWidth, COURT.halfWidth);
    this.lastFocus.copy(_focus);

    if (P.side) {
      // broadcast: from the sideline, looking across
      _pos.set(_focus.x * 0.3 + 13.5 * S.distance, P.height * S.height, _focus.z * 0.7 + 3.0);
      _look.set(_focus.x * 0.6, P.lookUp, _focus.z * 0.85);
      this.yaw = Math.PI / 2;
    } else {
      // direction from the rim to the focus (camera sits beyond the focus)
      let yaw = Math.atan2(_focus.x, Math.max(0.5, _focus.z));
      yaw = clamp(yaw * P.yawFollow, -P.yawLimit, P.yawLimit);
      this.orbitHold -= dt;
      if (this.orbitHold <= 0) this.orbitYaw = damp(this.orbitYaw, 0, 1.2, dt);
      yaw += this.orbitYaw;
      this.yaw = yaw + Math.PI; // camera looks toward -Z by default
      const dist = P.dist * S.distance * (1 - this.zoomPulse * 0.06);
      _pos.set(_focus.x + Math.sin(yaw) * dist, P.height * S.height, _focus.z + Math.cos(yaw) * dist);
      // look between the focus and the rim
      _look.set(lerp(_focus.x, 0, P.lookAhead), P.lookUp, lerp(_focus.z, 0, P.lookAhead));
    }
    // never below/inside things
    _pos.y = Math.max(1.2, _pos.y);
    if (_pos.z < COURT.baselineZ + 1) _pos.z = COURT.baselineZ + 1;

    if (!this.initialized) {
      this.posSpring.set(_pos);
      this.lookSpring.set(_look);
      this.initialized = true;
    }
    this.posSpring.freq = 1.15 * S.smoothing;
    this.lookSpring.freq = 1.7 * S.smoothing;
    this.posSpring.update(dt, _pos);
    this.lookSpring.update(dt, _look);
    cam.position.copy(this.posSpring.x);
    // subtle shake (impacts)
    if (this.shake > 0.001) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 43) * this.shake * 0.035;
      cam.position.y += Math.cos(t * 51) * this.shake * 0.03;
      this.shake = Math.max(0, this.shake - dt * 3.5);
    }
    cam.lookAt(this.lookSpring.x);
    // FOV with shooting tighten + pulse
    this.zoomPulse = Math.max(0, this.zoomPulse - dt * 1.6);
    const shooting = user.action && (user.action.type === 'shot' || user.action.type === 'layup');
    this.fovOffset = damp(this.fovOffset, shooting ? -3 : 0, 3, dt);
    const fov = P.fov + S.fov + this.fovOffset - this.zoomPulse * 2;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  _updateShowcase(dt, user) {
    const cam = this.camera;
    this.menuT += dt;
    const t = this.menuT;
    if (this.mode === 'locker') {
      // tight framing on the player for customization
      const yaw = Math.PI * 0.08 + Math.sin(t * 0.25) * 0.15;
      _focus.set(user.pos.x, 0, user.pos.z);
      _pos.set(_focus.x + Math.sin(user.yaw + yaw) * 3.4, 1.55, _focus.z + Math.cos(user.yaw + yaw) * 3.4);
      _look.set(_focus.x + 0.5, 1.08, _focus.z);
    } else {
      const r = 6.8;
      const a = t * 0.06 + 0.6;
      _focus.set(user.pos.x, 0, user.pos.z);
      _pos.set(_focus.x + Math.sin(a) * r, 2.3 + Math.sin(t * 0.13) * 0.25, _focus.z + Math.cos(a) * r);
      _look.set(_focus.x - Math.cos(a) * 1.3, 1.25, _focus.z + Math.sin(a) * 1.3);
    }
    if (!this.initialized) {
      this.posSpring.set(_pos);
      this.lookSpring.set(_look);
      this.initialized = true;
    }
    this.posSpring.freq = 0.9;
    this.lookSpring.freq = 1.2;
    this.posSpring.update(dt, _pos);
    this.lookSpring.update(dt, _look);
    cam.position.copy(this.posSpring.x);
    cam.lookAt(this.lookSpring.x);
    if (Math.abs(cam.fov - 38) > 0.01) {
      cam.fov = 38;
      cam.updateProjectionMatrix();
    }
  }
}
