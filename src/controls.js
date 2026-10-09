import { LANE_KEYS } from './lane-input.js';

const CONTROL_SELECTOR = 'button, input, select, textarea, [contenteditable="true"], [role="button"]';

function rhythmKey(event) {
  const keyFromCode = /^Key([ASDFHJKL])$/.exec(event.code ?? '')?.[1]?.toLowerCase();
  const keyFromLabel = event.key?.toLowerCase();
  const key = keyFromCode ?? keyFromLabel;
  return LANE_KEYS.includes(key) ? key : null;
}

function isUnrelatedControl(target, surface) {
  if (!target || target === surface.ownerDocument?.body
    || target === surface.ownerDocument?.documentElement) return false;
  const laneButton = target.closest?.('[data-lane-key]');
  if (laneButton && surface.contains?.(laneButton)) return false;
  const control = target.closest?.(CONTROL_SELECTOR)
    ?? (target.matches?.(CONTROL_SELECTOR) ? target : null);
  return Boolean(control && control !== surface);
}

export function bindRhythmControls({ surface, windowTarget, onEvent }) {
  const heldKeys = new Set();
  const pointers = new Set();
  let disposed = false;
  let cachedRect = null;

  const emit = event => onEvent(event);
  const readRect = () => {
    cachedRect = surface.getBoundingClientRect();
    return cachedRect;
  };
  const normalizedPointer = (event, type, rect) => {
    const bounds = rect ?? cachedRect ?? readRect();
    const x = bounds.width ? (event.clientX - bounds.left) / bounds.width : 0;
    const y = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0;
    const laneButton = event.target?.closest?.('[data-lane-key]');
    const lane = laneButton && surface.contains?.(laneButton)
      ? Number(laneButton.dataset.laneKey)
      : null;
    return {
      type,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      pointerType: event.pointerType || 'mouse',
      pointerId: event.pointerId,
      timeStamp: event.timeStamp,
      ...(Number.isInteger(lane) && lane >= 0 && lane < LANE_KEYS.length ? { lane } : {}),
    };
  };

  const releasePointers = () => {
    for (const pointerId of pointers) {
      if (surface.hasPointerCapture?.(pointerId)) surface.releasePointerCapture(pointerId);
      else if (!surface.hasPointerCapture) surface.releasePointerCapture?.(pointerId);
    }
    pointers.clear();
  };

  const reset = () => {
    if (disposed) return;
    heldKeys.clear();
    releasePointers();
    cachedRect = null;
    emit({ type: 'reset' });
  };

  const onKeyDown = event => {
    if (event.repeat || isUnrelatedControl(event.target, surface)) return;
    const key = rhythmKey(event);
    if (!key || heldKeys.has(key)) return;
    heldKeys.add(key);
    event.preventDefault();
    emit({ type: 'key-down', key });
  };

  const onKeyUp = event => {
    const key = rhythmKey(event);
    if (isUnrelatedControl(event.target, surface) && !heldKeys.has(key)) return;
    if (!key || !heldKeys.delete(key)) return;
    event.preventDefault();
    emit({ type: 'key-up', key });
  };

  const onPointerDown = event => {
    const isMouse = (event.pointerType || 'mouse') === 'mouse';
    if ((isMouse && event.button !== 0) || pointers.has(event.pointerId)
      || isUnrelatedControl(event.target, surface)) return;
    event.preventDefault();
    pointers.add(event.pointerId);
    surface.setPointerCapture?.(event.pointerId);
    emit(normalizedPointer(event, 'pointer-down', readRect()));
  };

  const onPointerMove = event => {
    if (!pointers.has(event.pointerId)) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
    const latest = coalesced && coalesced.length ? coalesced[coalesced.length - 1] : event;
    emit(normalizedPointer(latest, 'pointer-move'));
  };

  const endPointer = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    emit(normalizedPointer(event, 'pointer-up'));
    if (pointers.size === 0) cachedRect = null;
  };

  const onPointerCancel = event => {
    if (!pointers.has(event.pointerId)) return;
    endPointer(event);
  };

  const onLaneButtonClick = event => {
    if (event.detail !== 0) return;
    const laneButton = event.target?.closest?.('[data-lane-key]');
    const lane = Number(laneButton?.dataset?.laneKey);
    if (!laneButton || !surface.contains?.(laneButton) || !Number.isInteger(lane)
      || lane < 0 || lane >= LANE_KEYS.length) return;
    const pointerId = `keypad:${lane}`;
    const pointerEvent = { lane, pointerId, pointerType: 'keyboard', timeStamp: event.timeStamp };
    emit({ type: 'pointer-down', ...pointerEvent });
    emit({ type: 'pointer-up', ...pointerEvent });
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', endPointer);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('click', onLaneButtonClick);
  windowTarget.addEventListener('keydown', onKeyDown);
  windowTarget.addEventListener('keyup', onKeyUp);
  windowTarget.addEventListener('blur', reset);

  const dispose = () => {
    if (disposed) return;
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', endPointer);
    surface.removeEventListener('pointercancel', onPointerCancel);
    surface.removeEventListener('click', onLaneButtonClick);
    windowTarget.removeEventListener('keydown', onKeyDown);
    windowTarget.removeEventListener('keyup', onKeyUp);
    windowTarget.removeEventListener('blur', reset);
    reset();
    disposed = true;
  };

  return { reset, dispose };
}
