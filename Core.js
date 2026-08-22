/* =========================================================
   core.js — 状態管理・レンダラー初期化・物理・入力システム
   ========================================================= */
'use strict';

const STATE = {
  mode: null,
  running: false,
  time: 0,
  timeLimit: 60,
  players: [],
  obstacles: [],
  world: null,
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  goalZ: null,
  bigBalls: [],
  spinPlatforms: [],
  teamScores: { red: 0, blue: 0 },
};

const PLAYER_RADIUS = 0.55;
const BOT_NAMES = ["ぴよ太","もちお","くりむ","ぽてと","だんご","きなこ","うずら","はにわ","ぷりん","そばこ","つぶあん","めんたい","ころっけ","えだまめ","わさびん"];

// ---------- レンダラー ----------
function initRenderer() {
  const canvas = document.getElementById('gameCanvas');
  STATE.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  STATE.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  STATE.renderer.setSize(window.innerWidth, window.innerHeight);
  STATE.renderer.shadowMap.enabled = true;
  STATE.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  STATE.scene = new THREE.Scene();
  STATE.scene.background = new THREE.Color(0x87ceeb);
  STATE.scene.fog = new THREE.Fog(0x87ceeb, 40, 140);

  STATE.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
  STATE.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 150;
  STATE.scene.add(sun);

  window.addEventListener('resize', onResize);
}

function onResize() {
  STATE.camera.aspect = window.innerWidth / window.innerHeight;
  STATE.camera.updateProjectionMatrix();
  STATE.renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------- 物理 ----------
function initPhysics() {
  STATE.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  STATE.world.broadphase = new CANNON.SAPBroadphase(STATE.world);
  STATE.world.allowSleep = false;
  STATE.defaultMaterial = new CANNON.Material('default');
  const contact = new CANNON.ContactMaterial(STATE.defaultMaterial, STATE.defaultMaterial, {
    friction: 0.35, restitution: 0.15,
  });
  STATE.world.addContactMaterial(contact);
  STATE.world.defaultContactMaterial = contact;
}

// ---------- 入力 ----------
const Input = {
  moveX: 0, moveY: 0,
  jumpPressed: false,
  divePressed: false,
  grabHeld: false,
  active: false,
  touchId: null,
  baseX: 0, baseY: 0,
};

function setupJoystick() {
  const zone = document.getElementById('joystickZone');
  const base = document.getElementById('joystickBase');
  const stick = document.getElementById('joystickStick');
  const maxDist = 50;

  function startTouch(x, y, id) {
    Input.active = true;
    Input.touchId = id;
    Input.baseX = x; Input.baseY = y;
    base.style.left = (x - 55) + 'px';
    base.style.top = (y - 55) + 'px';
    base.style.display = 'block';
    stick.style.display = 'block';
    updateStick(x, y);
  }
  function updateStick(x, y) {
    const dx = x - Input.baseX;
    const dy = y - Input.baseY;
    const dist = Math.min(Math.hypot(dx, dy), maxDist);
    const angle = Math.atan2(dy, dx);
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist;
    stick.style.left = (Input.baseX + sx - 25) + 'px';
    stick.style.top = (Input.baseY + sy - 25) + 'px';
    Input.moveX = sx / maxDist;
    Input.moveY = sy / maxDist;
  }
  function endTouch() {
    Input.active = false;
    Input.touchId = null;
    Input.moveX = 0; Input.moveY = 0;
    base.style.display = 'none';
    stick.style.display = 'none';
  }

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    startTouch(t.clientX, t.clientY, t.identifier);
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === Input.touchId) updateStick(t.clientX, t.clientY);
    }
  }, { passive: false });

  zone.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === Input.touchId) endTouch();
  });
  zone.addEventListener('touchcancel', endTouch);

  // PC用マウス対応
  zone.addEventListener('mousedown', (e) => startTouch(e.clientX, e.clientY, 'mouse'));
  window.addEventListener('mousemove', (e) => { if (Input.active && Input.touchId === 'mouse') updateStick(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (Input.touchId === 'mouse') endTouch(); });
}

// ボタン共通ヘルパー：touch/mouse/clickを全部拾い、二重発火を防ぐ
function bindPressButton(el, onDown, onUp) {
  let pressed = false;
  const down = (e) => {
    if (e.cancelable) e.preventDefault();
    if (pressed) return;
    pressed = true;
    el.classList.add('pressed');
    onDown && onDown();
  };
  const up = (e) => {
    if (e && e.cancelable) e.preventDefault();
    if (!pressed) return;
    pressed = false;
    el.classList.remove('pressed');
    onUp && onUp();
  };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
  // clickはフォールバック（タッチが拾えない特殊環境向け）。pressed中は無視して二重発火防止。
  el.addEventListener('click', (e) => {
    e.preventDefault();
  });
}

function setupActionButtons() {
  bindPressButton(document.getElementById('btnJump'), () => { Input.jumpPressed = true; });
  bindPressButton(document.getElementById('btnDive'), () => { Input.divePressed = true; });
  bindPressButton(document.getElementById('btnGrab'), () => { Input.grabHeld = true; }, () => { Input.grabHeld = false; });
}

function setupFullscreen() {
  const btn = document.getElementById('fullscreenBtn');
  bindPressButton(btn, () => {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) {
        (el.requestFullscreen && el.requestFullscreen()) ||
        (el.webkitRequestFullscreen && el.webkitRequestFullscreen());
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      } else {
        document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen());
      }
    } catch (err) { /* フルスクリーン非対応環境では無視 */ }
  });
}

// ---------- バナー ----------
let bannerTimeout = null;
function showBanner(text) {
  if (!text) return;
  const el = document.getElementById('topBanner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => el.classList.remove('show'), 1600);
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
