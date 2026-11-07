/**
 * Swarm 1.6.11 regression checks. Serves the standalone HTML and drives Chrome.
 * Usage: node tests/swarm-v1611.cjs
 * Needs puppeteer-core (PUPPETEER_CORE) and Chrome (CHROME).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require(process.env.PUPPETEER_CORE || "puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const GAME = path.join(ROOT, "swarm-last-stand.html");
const BASE = process.env.SWARM_BASELINE || "";
const CHROME = process.env.CHROME || "/usr/local/bin/google-chrome";
const OUT = process.env.SWARM_OUT || path.join(ROOT, "swarm-proof");
const ART = process.env.SWARM_ART || "/opt/cursor/artifacts";

function serve(map) {
  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    const file = map[u];
    if (!file) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function inside(pt, w, h, bar) {
  return pt[0] >= -0.5 && pt[0] <= w + 0.5 && pt[1] >= -0.5 && pt[1] <= h - bar + 8;
}

function overlap(a, b) {
  if (!a || !b || a.w <= 0 || b.w <= 0) return false;
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(ART, { recursive: true });
  const a = path.join(OUT, name);
  const b = path.join(ART, name);
  await page.screenshot({ path: a });
  fs.copyFileSync(a, b);
  return a;
}

async function main() {
  const map = { "/": GAME, "/game.html": GAME };
  if (BASE) map["/base.html"] = BASE;
  const server = await serve(map);
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  const failures = [];
  const check = (name, ok, detail) => {
    const row = { name, ok: !!ok, detail };
    if (!ok) failures.push(row);
    console.log((ok ? "PASS " : "FAIL ") + name + (detail != null ? " " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
    return row;
  };
  const jsErrors = [];
  const results = [];

  async function open(viewport, url) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => jsErrors.push(viewport.width + " " + e.message));
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:" + port + url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__SW111, { timeout: 10000 });
    await page.evaluate(() => { const o = document.getElementById("overlay"); if (o) o.classList.add("off"); });
    return page;
  }

  // --- before picture, if the 1.6.10 baseline with __BASE is available ---
  if (BASE) {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:" + port + "/base.html", { waitUntil: "load" });
    await page.waitForFunction(() => window.__BASE);
    await page.evaluate(() => {
      document.getElementById("overlay").classList.add("off");
      window.__BASE.overlap();
    });
    await shot(page, "swarm-before-gore-360.png");
    await page.close();
  }

  const page = await open({ width: 360, height: 800 }, "/game.html");

  const cam = await page.evaluate(() => window.__SW111.cam());
  results.push(check("version", cam && (await page.evaluate(() => window.__SW111.ver())) === "1.6.11", await page.evaluate(() => window.__SW111.ver())));
  results.push(check("no zoom buttons", cam.zbtns === 0, cam.zbtns));
  results.push(check("KY remains 0.67", cam.KY === 0.67, cam.KY));
  results.push(check("playfield half-width stays 360", cam.hx === 360, cam.hx));
  results.push(check("playfield top stays -700", cam.top === -700, cam.top));
  const cornersOk = ["tl", "tr", "bl", "br", "gun"].every((k) => inside(cam.pts[k], 360, 800, cam.BARPX));
  results.push(check("360x800 whole field on screen", cornersOk, cam.pts));
  const sideGap = Math.min(cam.pts.tl[0], 360 - cam.pts.tr[0]);
  results.push(check("360x800 field meets the sides", sideGap >= 0 && sideGap <= 12, sideGap));

  const zoom = await page.evaluate(() => window.__SW111.zoomTry());
  results.push(check("zoom path cannot change scale", zoom.before === zoom.after && zoom.ZM === 1, zoom));
  const wheeled = await page.evaluate(() => {
    const before = window.__SW111.cam().VS;
    document.getElementById("c").dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true }));
    const after = window.__SW111.cam().VS;
    return { before, after };
  });
  results.push(check("wheel does not zoom", wheeled.before === wheeled.after, wheeled));

  const depth = await page.evaluate(() => window.__SW111.sceneOverlap());
  const ground = depth.log.map((d) => d.k + "@" + d.y).join(",");
  const limbBeforeEnemy = depth.log.findIndex((d) => d.k === "limb") < depth.log.findIndex((d) => d.k === "e");
  const bloodBefore = depth.log[0].k === "blood" && depth.log[0].y < 40;
  const airSeparate = depth.air.length === 1 && depth.air[0].air > 0 && !depth.log.some((d) => d.k === "gib");
  results.push(check("settled limb sorts under the closer walker", limbBeforeEnemy, ground));
  results.push(check("farther blood sorts behind", bloodBefore, ground));
  results.push(check("airborne gib is not in the ground pass", airSeparate, depth.air));
  await shot(page, "swarm-after-gore-360.png");

  const cap = await page.evaluate(() => window.__SW111.cap());
  results.push(check("CAP live count measured 180", cap.max === 180 && cap.cap === 180, cap));

  const suck = await page.evaluate(async () => {
    const api = window.__SW111;
    const prep = api.prepSuck();
    const c0 = api.counts().credits;
    const snapBefore = api.counts();
    api.end();
    const armed = api.counts();
    api.nanInject();
    api.step(0.05);
    const afterNan = api.sample();
    const creditsAfterNan = api.counts().credits - c0;
    let cleared = null;
    let closest = null;
    for (let i = 0; i < 160; i++) {
      api.step(0.05);
      const c = api.counts();
      const s = api.sample();
      if (s && i === 8) closest = s;
      const n = c.blood + c.guts + c.limbs + c.gibs;
      if (n === 0) {
        cleared = { t: +((i + 2) * 0.05).toFixed(2), gain: c.lastGain, events: c.rewardEvents, credits: c.credits - c0, snap: c.rewardSnap };
        break;
      }
    }
    for (let i = 0; i < 30; i++) api.step(0.05);
    const later = api.counts();
    return {
      prepN: prep.blood + prep.guts + prep.limbs + prep.gibs,
      waveBonus: armed.credits - c0,
      snap: armed.rewardSnap,
      afterNan, creditsAfterNan,
      cleared,
      laterEvents: later.rewardEvents,
      laterN: later.blood + later.guts + later.limbs + later.gibs,
      laterCredits: later.credits - c0,
      closest
    };
  });
  const expectedGain = Math.round(suck.snap * 0.35);
  results.push(check("suck keeps every gore piece until it arrives", suck.cleared && suck.laterN === 0, suck.cleared));
  results.push(check("suck duration about 2x the 1.75s baseline", suck.cleared && suck.cleared.t >= 3.15 && suck.cleared.t <= 4.0, suck.cleared && suck.cleared.t));
  results.push(check("wave bonus only until the suck finishes", suck.waveBonus === 92 && suck.creditsAfterNan === 92, { waveBonus: suck.waveBonus, early: suck.creditsAfterNan }));
  results.push(check("gore reward is 35% once", suck.cleared && suck.cleared.gain === expectedGain && suck.cleared.events === 1 && suck.laterEvents === 1 && suck.laterCredits === 92 + expectedGain, { expectedGain, suck }));
  results.push(check("NaN gore stays finite and is not deleted on the spot", afterFinite(suck), suck.afterNan));

  const guns = await page.evaluate(() => {
    const api = window.__SW111;
    api.unlock("shotgun");
    api.unlock("laser");
    api.unlock("sniper");
    const sniper = api.shoot("sniper", 0, 0, -Math.PI / 2);
    const laser = api.shoot("laser", 0, 0, -Math.PI / 2);
    const side = api.placeSide(80, 30);
    api.armWave();
    api.placeEnemy(80, -80);
    api.choose(side, "shotgun");
    api.setMain("laser");
    api.clearShots();
    side.cd = 0;
    api.step(0.05);
    const sideShot = api.shots();
    api.setMain("sniper");
    api.clearShots();
    side.cd = 0;
    api.step(0.05);
    const sideStill = api.shots();
    const aux = api.placeAux(40, 0);
    aux.wepId = "shotgun";
    aux.cd = 0;
    api.clearShots();
    api.step(0.05);
    const linked = { shots: api.shots(), wepId: aux.wepId, linked: aux.linked };
    api.setMain("laser");
    api.placeEnemy(40, -60);
    api.toughen();
    aux.cd = 0;
    api.clearShots();
    api.step(0.05);
    const linkedNow = api.shots();
    api.openSide(side);
    const picker = api.picker();
    const scr = api.screen(side.x, side.y);
    const hitNear = !!api.hitSide(scr.clientX + 18, scr.clientY);
    const hitFar = !!api.hitSide(scr.clientX + 50, scr.clientY);
    return { sniper, laser, sideShot, sideStill, linked, linkedNow, picker, hitNear, hitFar, store: api.store(), main: api.main() };
  });

  const beam = (pack, color, wd) => {
    const beams = pack.fx.filter((f) => f.k === "beam");
    return pack.bullets.length === 0 && beams.length >= 1 && beams.every((f) => f.c === color && f.wd === wd);
  };
  results.push(check("sniper is a thin white hitscan beam", beam(guns.sniper, "#ffffff", 1), guns.sniper));
  results.push(check("laser is a pink straight beam", beam(guns.laser, "#ff4a9a", 2) && guns.laser.fx.every((f) => f.k !== "beam" || Math.abs((f.x2 - f.x) * 0 + (f.y2 - f.y)) >= 0), guns.laser.fx));
  const straight = guns.laser.fx.filter((f) => f.k === "beam").every((f) => {
    const dx = f.x2 - f.x, dy = f.y2 - f.y;
    return Math.abs(dx) < 1e-6 && dy < 0;
  });
  results.push(check("laser beam is straight up the aim", straight, guns.laser.fx));
  results.push(check("unlinked side gun fires the picked shotgun", guns.sideShot.bullets.some((b) => b.wid === "shotgun") && !guns.sideShot.fx.some((f) => f.c === "#ff4a9a"), guns.sideShot));
  results.push(check("side gun does not follow a main weapon change", guns.sideStill.bullets.some((b) => b.wid === "shotgun") && !guns.sideStill.fx.some((f) => f.k === "beam" && f.c === "#ffffff"), guns.sideStill));
  results.push(check("linked gun ignores its own weapon override", guns.linked.linked === true && guns.linked.wepId == null && beam(guns.linked.shots, "#ffffff", 1), guns.linked));
  results.push(check("linked gun updates when the main weapon changes", beam(guns.linkedNow, "#ff4a9a", 2), guns.linkedNow));
  const names = guns.picker.buttons.map((b) => b.wep || b.text);
  results.push(check("picker lists purchased guns only", names.some((n) => n === "shotgun") && names.some((n) => n === "laser") && !names.some((n) => /ROCKET|rocket|HEAVY|heavy/.test(n)), names));
  const heights = guns.picker.buttons.map((b) => b.h);
  results.push(check("picker touch targets are at least 44px", heights.length >= 3 && heights.every((h) => h >= 44), heights));
  results.push(check("sell and picker do not overlap", guns.picker.sell.display !== "none" && !overlap(guns.picker.pick, guns.picker.sell), { pick: guns.picker.pick, sell: guns.picker.sell }));
  results.push(check("sell touch target is at least 44px", guns.picker.sell.h >= 44 && guns.picker.sell.w >= 44, guns.picker.sell));
  results.push(check("side gun screen hit is about 44px and not the whole field", guns.hitNear === true && guns.hitFar === false, { near: guns.hitNear, far: guns.hitFar }));
  results.push(check("side gun choice is stored", guns.store["80,30"] === "shotgun", guns.store));
  await shot(page, "swarm-sidegun-picker-360.png");

  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__SW111);
  const reloaded = await page.evaluate(() => {
    document.getElementById("overlay").classList.add("off");
    window.__SW111.unlock("shotgun");
    const s = window.__SW111.placeSide(80, 30);
    return { id: window.__SW111.sideWeapon(s), store: window.__SW111.store() };
  });
  results.push(check("side gun choice survives reload", reloaded.id === "shotgun", reloaded));

  // field framing shots
  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    const api = window.__SW111;
    document.getElementById("overlay").classList.add("off");
    api.clearStage();
    api.placeEnemy(-340, -660);
    api.placeEnemy(340, -660);
    api.placeEnemy(-340, 100);
    api.placeEnemy(340, 100);
    api.placeEnemy(0, -180);
    api.draw();
  });
  await shot(page, "swarm-field-360x800.png");

  await page.setViewport({ width: 720, height: 1600, deviceScaleFactor: 1 });
  const cam720 = await page.evaluate(() => { window.dispatchEvent(new Event("resize")); return window.__SW111.cam(); });
  const ok720 = ["tl", "tr", "bl", "br"].every((k) => inside(cam720.pts[k], 720, 1600, cam720.BARPX));
  const gap720 = Math.min(cam720.pts.tl[0], 720 - cam720.pts.tr[0]);
  results.push(check("720x1600 whole field on screen", ok720 && gap720 >= 0 && gap720 <= 16, { gap720, pts: cam720.pts, VS: cam720.VS, hx: cam720.hx }));
  await page.evaluate(() => window.__SW111.draw());
  await shot(page, "swarm-field-720x1600.png");

  await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 1 });
  const cam320 = await page.evaluate(() => { window.dispatchEvent(new Event("resize")); return window.__SW111.cam(); });
  const ok320 = ["tl", "tr", "bl", "br"].every((k) => inside(cam320.pts[k], 320, 568, cam320.BARPX));
  results.push(check("320x568 whole field on screen", ok320, { pts: cam320.pts, VS: cam320.VS, BAR: cam320.BARPX }));
  await page.evaluate(() => window.__SW111.draw());
  await shot(page, "swarm-field-320x568.png");

  results.push(check("no JavaScript page errors", jsErrors.length === 0, jsErrors));

  const report = {
    version: "1.6.11",
    baselineSuckSec: 1.75,
    measured: { suck, cam360: cam, cam720, cam320, cap, guns: { store: guns.store, picker: names } },
    results
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "v1611-report.json"), JSON.stringify(report, null, 2));
  fs.mkdirSync(ART, { recursive: true });
  fs.copyFileSync(path.join(OUT, "v1611-report.json"), path.join(ART, "swarm-v1611-report.json"));

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAILED " + failures.length);
    process.exit(1);
  }
  console.log("ALL PASS " + results.length);
}

function afterFinite(suck) {
  return suck.afterNan && suck.afterNan.finite === true && Number.isFinite(suck.afterNan.x) && Number.isFinite(suck.afterNan.y);
}

main().catch((e) => { console.error(e); process.exit(1); });
