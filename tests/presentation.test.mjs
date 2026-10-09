import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHOWS } from '../src/content.js';
import { renderEndingView, renderPerformanceView } from '../src/views.js';

const projectUrl = new URL('../', import.meta.url);

function lastCssRule(source, className) {
  return [...source.matchAll(new RegExp('\\.' + className + '\\s*\\{([^}]*)\\}', 'g'))].at(-1)?.[1] ?? '';
}

test('uses the supplied cinematic video as a shared page backdrop', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', projectUrl), 'utf8'),
    readFile(new URL('styles.css', projectUrl), 'utf8'),
  ]);

  assert.match(html, /class="page-background"[\s\S]*?<video[\s\S]*?autoplay[\s\S]*?muted[\s\S]*?loop[\s\S]*?playsinline/);
  assert.match(html, /d8j0ntlcm91z4\.cloudfront\.net[^"]+\.mp4/);
  assert.match(html, /d2ol7oe51mr4n9\.cloudfront\.net[^"]+\.webp/);
  assert.match(css, /\.page-background\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.page-scrim\s*\{[^}]*pointer-events:\s*none/s);
});

test('keeps the game content above the backdrop and removes the crossed campaign flourish', async () => {
  const css = await readFile(new URL('styles.css', projectUrl), 'utf8');

  assert.match(css, /\.app-main\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.app-footer\s*\{[^}]*backdrop-filter:\s*blur/s);
  assert.doesNotMatch(css, /\.campaign-banner::after\s*\{[^}]*content:\s*""/s);
});

test('uses dark glass surfaces with white primary and frosted secondary actions', async () => {
  const css = await readFile(new URL('styles.css', projectUrl), 'utf8');

  const panelMatch = css.match(/--surface-panel:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const panelColor = panelMatch?.slice(1, 4).map(Number) ?? [];
  const panelAlpha = Number(panelMatch?.[4]);
  const insetAlpha = Number(css.match(/--surface-inset:\s*rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/)?.[1]);
  assert.ok(Math.max(...panelColor) - Math.min(...panelColor) < 20);
  assert.ok(panelAlpha > 0.4 && panelAlpha <= 0.65);
  assert.ok(insetAlpha > 0.04 && insetAlpha <= 0.12);
  assert.match(css, /\.section-panel,[\s\S]*?\.ending-grid > aside,[\s\S]*?background:\s*linear-gradient\([^;]*var\(--surface-panel\)/);
  assert.match(css, /\.resource-item,[\s\S]*?\.ending-result-row\s*\{\s*background:\s*var\(--surface-inset\)/);
  assert.match(css, /\.section-panel,[\s\S]*?backdrop-filter:\s*blur\(24px\)/);
  assert.match(lastCssRule(css, 'primary-button'), /background:\s*#fff\s*;/);
  assert.match(lastCssRule(css, 'primary-button'), /color:\s*#[0-9a-f]{3,6}\s*;/i);
  assert.match(lastCssRule(css, 'secondary-button'), /backdrop-filter:\s*blur\(/);
});

test('shows the remaining season credits on the finale screen', () => {
  const html = renderEndingView({
    campaign: {
      credits: 75,
      popularity: 80,
      difficulty: 'standard',
      members: 4,
      actionHistory: ['promote', 'recruit'],
      showResults: SHOWS.map(() => ({ score: 1000, rank: 'A' })),
    },
    ending: { rank: 'Gold', score: 3000 },
    saveNotice: '',
  });

  assert.match(html, /剩余经费[\s\S]{0,120}<strong>75<\/strong>/);
});

test('presents the eight matching lane keys, touch pads, live accuracy, and chart progress', async () => {
  const css = await readFile(new URL('styles.css', projectUrl), 'utf8');
  const html = renderPerformanceView({
    campaign: { showIndex: 0 },
    show: SHOWS[0],
    runtime: {
      paused: false,
      rhythm: {
        score: 1000,
        combo: 1,
        accuracyPoints: 1000,
        chart: SHOWS[0].chart,
        results: [{}],
      },
    },
    preferences: { muted: false },
    saveUnavailable: false,
    restoredActiveShow: false,
  });

  assert.match(html, /aria-label="[^"\n]*ASDFHJKL[^"\n]*"/);
  assert.equal((html.match(/data-lane-key=/g) ?? []).length, 8);
  assert.match(html, /八轨触控键盘/);
  assert.doesNotMatch(html, /Flick|Drag|Space|A\/D/);
  assert.match(css, /\.lane-keypad\s*\{[^}]*grid-template-columns:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(html, /id="accuracy-value"/);
  assert.match(html, /id="progress-value"/);
  assert.doesNotMatch(html, /pulse-target/);
});

test('keeps a black eight-lane playfield', async () => {
  const css = await readFile(new URL('styles.css', projectUrl), 'utf8');
  assert.match(css, /\.stage-scene\s*\{[^}]*background:\s*#000(?:000)?\s*;/s);
  assert.match(css, /\.lane-keypad/);
});

test('main delegates performance internals to the controller boundary', async () => {
  const source = await readFile(new URL('src/main.js', projectUrl), 'utf8');
  assert.match(source, /createPerformanceController\(/);
  assert.match(source, /performanceController\.enter\(/);
  assert.match(source, /performanceController\.leave\(/);
  assert.match(source, /performanceController\.setPreferences\(/);
  assert.doesNotMatch(
    source,
    /createAudioEngine\s*\(\s*\)|createRhythmRuntime|requestAnimationFrame|bindRhythmControls|drawStage/,
  );
});
