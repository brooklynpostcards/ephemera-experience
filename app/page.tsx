'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  captureReleaseVelocity, getFoldWindow, resistDrag, resolveRelease, startFold, stepFold,
  type FoldConfig, type FoldReleaseCapture, type FoldReleasePlan, type FoldSample, type FoldState,
} from '@/lib/fold-physics';
import { getFoldCrease, getFoldSpin, getFoldSpinWeight } from '@/lib/fold-pose';
import { buildWindow, describeRoom, EXHIBITS, FACES, INITIAL, move, type Action, type Position, type Room } from '@/lib/museum';

type DragIntent = 'pending' | 'walk' | 'turn';

// Recorded starting values; high-velocity releases are explicitly capped at three rooms.
const FOLD_CONFIG: FoldConfig = Object.freeze({
  sampleWindowSeconds: 0.1, maxSamples: 16,
  maxVelocityRoomsPerSecond: 8, decayPerSecond: 4.5,
  maxTravelRooms: 3, multiRoomVelocity: 3,
  dragLimitRooms: 1, dragResistanceRooms: 0.15,
  spinVelocity: 5.5, spinFullVelocity: 8, stepVelocity: 1.5,
  coastExitVelocity: 0.35, coastMaxSeconds: 0.32,
  springFrequencyHz: 3, normalDampingRatio: 1, hardDampingRatio: 0.82,
  maxVisualOvershootRooms: 0.18, positionEpsilonRooms: 0.001,
  velocityEpsilon: 0.01, maxReleaseSeconds: 2,
});

type ActiveDrag = {
  readonly pointerId: number;
  readonly captureTarget: Element;
  readonly startX: number;
  readonly startY: number;
  /** Frozen at pointer-down; pixels representing one room of vertical travel. */
  readonly roomSpanPixels: number;
  /** Settled integer world state captured once for the entire gesture. */
  readonly origin: Readonly<Position>;
  readonly intent: DragIntent;
  /** Raw normalized gesture distance, used for velocity samples. */
  readonly rawOffsetRooms: number;
  /** Resisted displacement for the eventual fold rendering. */
  readonly visualOffsetRooms: number;
  /** Bounded recent samples; the pure estimator applies time-window filtering. */
  readonly samples: readonly FoldSample[];
};

type FoldMotion = {
  readonly generation: number;
  readonly origin: Readonly<Position>;
  state: FoldState;
  accumulatorSeconds: number;
  lastTimeSeconds: number;
  firstFrame: boolean;
  anchorDelta: number;
};

/** Render-only integer window; never becomes settled world state mid-flight. */
type FoldView = {
  readonly origin: Readonly<Position>;
  readonly anchorDelta: number;
};

type PendingRelease = {
  readonly origin: Readonly<Position>;
  readonly visualOffsetRooms: number;
  readonly capture: FoldReleaseCapture;
};

const FIXED_STEP_SECONDS = 1 / 120;
const MAX_ACCUMULATED_SECONDS = 0.05;
const LONG_FRAME_GAP_SECONDS = 0.25;

/** Direct, bounded writes to the three existing views; no layout reads. */
function paintDrag(element: HTMLDivElement, offsetRooms: number | null, originDepth?: number, spinDegrees = 0) {
  for (const room of element.querySelectorAll<HTMLElement>('.museum-room')) {
    const left = room.querySelector<HTMLElement>('.paper-left');
    const right = room.querySelector<HTMLElement>('.paper-right');
    if (offsetRooms === null) {
      room.style.removeProperty('transform');
      room.style.removeProperty('opacity');
      left?.style.removeProperty('transform');
      right?.style.removeProperty('transform');
      continue;
    }
    // Absolute descriptor depth stays valid even while an anchor render is pending.
    const relative = (originDepth === undefined ? Number(room.dataset.offset)
      : Number(room.dataset.depth) - originDepth) - offsetRooms;
    room.style.transform = `translateX(${135 * relative}%) translateZ(${-340 * Math.abs(relative)}px) rotateY(${20 * relative}deg)`;
    room.style.opacity = String(Math.max(0, Math.min(1, (1.5 - Math.abs(relative)) * 2)));
    // Stable room-relative displacement survives rebases and reaches idle at integers.
    const foldsLeft = room.dataset.fold === 'left';
    const handedness = foldsLeft ? 1 : -1;
    const crease = getFoldCrease(-relative) * handedness;
    // Only the descriptor's moving leaf spins; base crease and room/UI poses stay intact.
    const spin = spinDegrees * handedness * getFoldSpinWeight(-relative);
    if (left) left.style.transform = `rotateY(${-40 + crease + (foldsLeft ? spin : 0)}deg)`;
    if (right) right.style.transform = `rotateY(${40 + crease + (foldsLeft ? 0 : spin)}deg)`;
  }
}

function Artwork({ room, priority = false }: { room: Room; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="image-failure"><strong>Image unavailable</strong><span>{room.title}</span><small>You can continue to the next room.</small></span>
  ) : (
    <img src={room.src} alt={room.title} width={900} height={900} decoding="async"
      fetchPriority={priority ? 'high' : 'low'} onError={() => setFailed(true)} draggable={false} />
  );
}

export default function Museum() {
  const [position, setPosition] = useState(INITIAL);
  const [foldView, setFoldView] = useState<FoldView | null>(null);
  const [action, setAction] = useState<Action | 'idle' | 'dragging'>('idle');
  const [inspecting, setInspecting] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const inspection = useRef(false);
  const reduced = useRef(false);
  // A room commit replaces the wheel listener, but must not restart an inertial burst.
  const wheelBurst = useRef({ lastEvent: -Infinity, total: 0, consumed: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDrag = useRef<ActiveDrag | null>(null);
  // Consumed once by the one-room release controller.
  const pendingRelease = useRef<PendingRelease | null>(null);
  const foldMotion = useRef<FoldMotion | null>(null);
  const foldFrame = useRef<number | null>(null);
  const completionPending = useRef(false);
  const foldGeneration = useRef(0);
  const mounted = useRef(true);
  const suppressClick = useRef(false);
  const current = describeRoom(position);
  const rooms = buildWindow(foldView
    ? { ...foldView.origin, depth: foldView.origin.depth + foldView.anchorDelta }
    : position);

  // Finish against the captured origin once; keep the DOM/busy ownership until
  // React has applied the new integer room roles, then clean up before paint.
  const finishMotion = useCallback((generation: number) => {
    const motion = foldMotion.current;
    if (!mounted.current || !motion || motion.generation !== generation) return;
    if (foldFrame.current !== null) cancelAnimationFrame(foldFrame.current);
    foldFrame.current = null;
    foldMotion.current = null;
    pendingRelease.current = null;
    completionPending.current = true;
    setFoldView(null);
    const delta = motion.state.plan.targetDelta;
    if (delta !== 0) {
      setPosition({ ...motion.origin, depth: motion.origin.depth + delta });
      setHasMoved(true);
    }
    setAction('idle');
  }, []);

  useLayoutEffect(() => {
    const motion = foldMotion.current;
    if (motion && stage.current) {
      // Read the latest simulation ref, not the progress that requested this render.
      paintDrag(stage.current, motion.state.offsetRooms, motion.origin.depth, getFoldSpin(motion.state));
    }
    if (!completionPending.current || action !== 'idle') return;
    completionPending.current = false;
    if (stage.current) {
      paintDrag(stage.current, null);
      // Flush the settled pose while transform transitions are still disabled.
      // This is one completion-only layout read, never a per-frame read.
      void stage.current.offsetWidth;
      stage.current.removeAttribute('data-fold-drag');
    }
    busy.current = false;
  }, [position, action, foldView]);

  const startMotion = useCallback((origin: Readonly<Position>, plan: FoldReleasePlan) => {
    const generation = ++foldGeneration.current;
    const { anchorDelta } = getFoldWindow(plan.startOffsetRooms);
    foldMotion.current = {
      generation,
      origin,
      state: startFold(plan),
      accumulatorSeconds: 0,
      lastTimeSeconds: performance.now() / 1000,
      firstFrame: true,
      anchorDelta,
    };
    setFoldView({ origin, anchorDelta });
    busy.current = true;
    setAction('dragging');
    if (stage.current) {
      stage.current.setAttribute('data-fold-drag', '');
      // The release envelope starts at exact zero; live drag also uses this default.
      paintDrag(stage.current, plan.startOffsetRooms, origin.depth);
      stage.current.focus({ preventScroll: true });
    }
    const tick = (timestampMilliseconds: number) => {
      const motion = foldMotion.current;
      if (!mounted.current || !motion || motion.generation !== generation) return;
      const timestampSeconds = timestampMilliseconds / 1000;
      // A same-frame RAF timestamp can precede the event's performance.now().
      // Clamp only that first baseline mismatch; later time regressions abort.
      const elapsed = timestampSeconds - motion.lastTimeSeconds;
      const frameSeconds = motion.firstFrame ? Math.max(0, elapsed) : elapsed;
      motion.firstFrame = false;
      motion.lastTimeSeconds = timestampSeconds;
      if (!Number.isFinite(frameSeconds) || frameSeconds < 0
          || frameSeconds > LONG_FRAME_GAP_SECONDS || reduced.current || document.hidden) {
        finishMotion(generation);
        return;
      }
      motion.accumulatorSeconds = Math.min(
        MAX_ACCUMULATED_SECONDS,
        motion.accumulatorSeconds + frameSeconds,
      );
      let steps = 0;
      while (motion.accumulatorSeconds + 1e-12 >= FIXED_STEP_SECONDS && steps < 6
          && motion.state.phase !== 'done') {
        motion.state = stepFold(motion.state, FIXED_STEP_SECONDS, FOLD_CONFIG);
        motion.accumulatorSeconds = Math.max(0, motion.accumulatorSeconds - FIXED_STEP_SECONDS);
        steps += 1;
      }
      if (stage.current) paintDrag(stage.current, motion.state.offsetRooms, motion.origin.depth, getFoldSpin(motion.state));
      if (motion.state.phase === 'done') {
        finishMotion(generation);
      } else {
        const nextAnchor = getFoldWindow(motion.state.offsetRooms).anchorDelta;
        if (nextAnchor !== motion.anchorDelta) {
          motion.anchorDelta = nextAnchor;
          setFoldView({ origin: motion.origin, anchorDelta: nextAnchor });
        }
        foldFrame.current = requestAnimationFrame(tick);
      }
    };
    foldFrame.current = requestAnimationFrame(tick);
  }, [finishMotion]);

  // Capture loss caused by normal pointer-up sees no drag owner and cannot cancel release.
  const detachDrag = useCallback((pointerId: number) => {
    const drag = activeDrag.current;
    if (!drag || drag.pointerId !== pointerId) return;
    activeDrag.current = null;
    try {
      if (drag.captureTarget.hasPointerCapture(pointerId)) drag.captureTarget.releasePointerCapture(pointerId);
    } catch { /* The browser may already have released or detached the target. */ }
    return drag;
  }, []);

  const clearDrag = useCallback((pointerId: number, returnToOrigin = false) => {
    const drag = detachDrag(pointerId);
    if (!drag) return;
    pendingRelease.current = null;
    if (drag.intent === 'walk') {
      if (returnToOrigin && !reduced.current
          && Math.abs(drag.visualOffsetRooms) > FOLD_CONFIG.positionEpsilonRooms) {
        startMotion(drag.origin, resolveRelease({
          kind: 'cancel', offsetRooms: drag.visualOffsetRooms,
        }, FOLD_CONFIG));
      } else {
        if (stage.current) {
          paintDrag(stage.current, null);
          stage.current.removeAttribute('data-fold-drag');
        }
        busy.current = false;
        setAction('idle');
      }
    }
    return drag;
  }, [detachDrag, startMotion]);

  const inspect = useCallback((open: boolean) => {
    if (busy.current) return;
    if (activeDrag.current) clearDrag(activeDrag.current.pointerId);
    inspection.current = open;
    setInspecting(open);
  }, [clearDrag]);

  const navigate = useCallback((next: Action) => {
    if (busy.current || inspection.current) return;
    if (activeDrag.current) clearDrag(activeDrag.current.pointerId);
    if (reduced.current) stage.current?.focus({ preventScroll: true });
    busy.current = true;
    setHasMoved(true);
    setAction(next);
    const duration = reduced.current ? 160 : next === 'left' || next === 'right' ? 320 : 500;
    timer.current = setTimeout(() => {
      const restoreFocus = document.activeElement === frame.current;
      setPosition((value) => move(value, next));
      setAction('idle');
      busy.current = false;
      timer.current = null;
      if (restoreFocus) stage.current?.focus({ preventScroll: true });
    }, duration);
  }, [clearDrag]);

  const navigateStep = useCallback((direction: -1 | 1) => {
    // Preserve the existing reduced-motion fade; ordinary step inputs use the shared spring.
    if (reduced.current) {
      navigate(direction > 0 ? 'forward' : 'back');
      return;
    }
    if (busy.current || inspection.current) return;
    if (activeDrag.current) clearDrag(activeDrag.current.pointerId);
    const origin = Object.freeze({ ...position });
    startMotion(origin, resolveRelease({ kind: 'step', direction }, FOLD_CONFIG));
  }, [clearDrag, navigate, position, startMotion]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    mounted.current = true;
    const sync = () => {
      reduced.current = preference.matches;
      if (preference.matches) {
        if (activeDrag.current) clearDrag(activeDrag.current.pointerId);
        if (foldMotion.current) finishMotion(foldMotion.current.generation);
      }
    };
    const visibility = () => {
      if (!document.hidden) return;
      if (activeDrag.current) clearDrag(activeDrag.current.pointerId);
      if (foldMotion.current) finishMotion(foldMotion.current.generation);
    };
    sync();
    preference.addEventListener('change', sync);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      preference.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', visibility);
      if (timer.current) clearTimeout(timer.current);
      foldGeneration.current += 1;
      if (foldFrame.current !== null) cancelAnimationFrame(foldFrame.current);
      foldFrame.current = null;
      foldMotion.current = null;
      completionPending.current = false;
      pendingRelease.current = null;
      activeDrag.current = null;
      if (stage.current) {
        paintDrag(stage.current, null);
        stage.current.removeAttribute('data-fold-drag');
      }
      busy.current = false;
    };
  }, [clearDrag, finishMotion]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const element = event.target as HTMLElement;
      if (element.closest('input, textarea, select, [contenteditable="true"]') || inspection.current) return;
      const keys: Record<string, Action> = {
        ArrowUp: 'forward', w: 'forward', ArrowDown: 'back', s: 'back',
        ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',
      };
      const next = keys[event.key] ?? keys[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        if (next === 'forward' || next === 'back') navigateStep(next === 'forward' ? 1 : -1);
        else navigate(next);
      }
      else if ((event.key === 'Enter' || event.key === ' ') && !element.closest('button, a')) {
        event.preventDefault(); inspect(true);
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [navigate, navigateStep, inspect]);

  useEffect(() => {
    const element = stage.current;
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || inspection.current || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      const burst = wheelBurst.current;
      if (now - burst.lastEvent > 240) { burst.consumed = false; burst.total = 0; }
      burst.lastEvent = now;
      if (busy.current || burst.consumed) { burst.consumed = true; return; }
      burst.total += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1);
      if (Math.abs(burst.total) >= 35) { burst.consumed = true; navigateStep(burst.total < 0 ? 1 : -1); }
    }
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [navigateStep]);

  return (
    <Dialog open={inspecting} onOpenChange={inspect}>
      <main className="museum" style={{ '--accent': current.accent } as CSSProperties} data-depth={position.depth} data-facing={position.facing}>
        <a className="skip-link" href="#walkthrough">Skip to the museum</a>
        <header className="masthead">
          <div className="wordmark"><span className="registration" aria-hidden="true">+</span><h1>EPHEMERA<span>.</span></h1></div>
          <p className="masthead-note">An unfolding archive<br /><span>{EXHIBITS.length} things kept.</span></p>
        </header>
        <div className="room-heading"><p>THE PAPER MUSEUM</p><span>Room {current.number}<span className="heading-divider">/</span>{FACES[position.facing]}</span></div>
        <div id="walkthrough" ref={stage} tabIndex={-1} className={`stage action-${action}`} aria-label="Museum walkthrough"
          onPointerDown={(event) => {
            const touchInsideEdges = event.pointerType === 'touch'
              && event.clientX >= 24 && event.clientX <= window.innerWidth - 24;
            const primaryMouse = event.pointerType === 'mouse' && event.button === 0;
            if (!event.isPrimary || (!touchInsideEdges && !primaryMouse) || activeDrag.current
                || busy.current || inspection.current) return;

            suppressClick.current = false;
            pendingRelease.current = null;
            const captureTarget = event.target instanceof Element ? event.target : event.currentTarget;
            activeDrag.current = {
              pointerId: event.pointerId,
              captureTarget,
              startX: event.clientX,
              startY: event.clientY,
              roomSpanPixels: Math.max(180, Math.min(420, event.currentTarget.clientHeight * 0.65)),
              origin: Object.freeze({ ...position }),
              intent: 'pending',
              rawOffsetRooms: 0,
              visualOffsetRooms: 0,
              samples: [{ timeSeconds: event.timeStamp / 1000, offsetRooms: 0 }],
            };
            try {
              // Capturing the original target preserves its eventual click activation.
              captureTarget.setPointerCapture(event.pointerId);
            } catch {
              activeDrag.current = null;
            }
          }}
          onPointerMove={(event) => {
            let drag = activeDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (inspection.current || (busy.current && drag.intent !== 'walk')
                || (event.pointerType === 'mouse' && (event.buttons & 1) === 0)) {
              clearDrag(event.pointerId, true);
              return;
            }
            const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
            const timeSeconds = event.timeStamp / 1000;
            const rawOffsetRooms = -dy / drag.roomSpanPixels;
            if (!Number.isFinite(rawOffsetRooms) || !Number.isFinite(timeSeconds)) return;
            const latest = drag.samples.at(-1);
            if (latest && timeSeconds < latest.timeSeconds) return;
            const samples = [
              ...drag.samples.filter((sample) => sample.timeSeconds >= timeSeconds - FOLD_CONFIG.sampleWindowSeconds
                && sample.timeSeconds < timeSeconds),
              { timeSeconds, offsetRooms: rawOffsetRooms },
            ].slice(-FOLD_CONFIG.maxSamples);
            let intent = drag.intent;
            if (intent === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
              if (Math.abs(dy) >= Math.abs(dx) * 1.2) intent = 'walk';
              else if (Math.abs(dx) >= Math.abs(dy) * 1.2) intent = 'turn';
            }
            if (intent === 'walk' && drag.intent !== 'walk') {
              // Move capture off the artwork BEFORE its controls become inert.
              try { event.currentTarget.setPointerCapture(event.pointerId); }
              catch { clearDrag(event.pointerId); return; }
              drag = { ...drag, captureTarget: event.currentTarget };
              busy.current = true;
              suppressClick.current = true;
              setAction('dragging');
              stage.current?.focus({ preventScroll: true });
              if (!reduced.current) event.currentTarget.setAttribute('data-fold-drag', '');
            }
            const visualOffsetRooms = intent === 'walk' ? resistDrag(rawOffsetRooms, FOLD_CONFIG) : 0;
            activeDrag.current = { ...drag, intent, samples, rawOffsetRooms, visualOffsetRooms };
            if (intent === 'walk' && !reduced.current) paintDrag(event.currentTarget, visualOffsetRooms);
          }}
          onPointerUp={(event) => {
            const start = activeDrag.current;
            if (!start || start.pointerId !== event.pointerId) return;
            const dx = event.clientX - start.startX, dy = event.clientY - start.startY;
            const walking = start.intent === 'walk' || (start.intent === 'pending'
              && Math.abs(dy) >= 8 && Math.abs(dy) >= Math.abs(dx) * 1.2);
            const turning = start.intent === 'turn' || (start.intent === 'pending' && Math.abs(dx) >= Math.abs(dy) * 1.2);
            if (walking && !reduced.current) {
              const rawOffsetRooms = -dy / start.roomSpanPixels;
              const timeSeconds = event.timeStamp / 1000;
              if (!Number.isFinite(rawOffsetRooms) || !Number.isFinite(timeSeconds)) {
                clearDrag(event.pointerId, true);
                return;
              }
              pendingRelease.current = {
                origin: start.origin,
                visualOffsetRooms: resistDrag(rawOffsetRooms, FOLD_CONFIG),
                capture: captureReleaseVelocity(start.samples, { timeSeconds, offsetRooms: rawOffsetRooms }, FOLD_CONFIG),
              };
              const release = pendingRelease.current;
              const plan = resolveRelease({
                kind: 'pointer',
                offsetRooms: release.visualOffsetRooms,
                velocityRoomsPerSecond: release.capture.velocityRoomsPerSecond,
              }, FOLD_CONFIG);
              detachDrag(event.pointerId);
              pendingRelease.current = null;
              suppressClick.current = true;
              startMotion(release.origin, plan);
              return;
            }
            clearDrag(event.pointerId);
            if ((!walking && !turning) || Math.abs(walking ? dy : dx) < 45) return;
            suppressClick.current = true;
            navigate(walking ? dy < 0 ? 'forward' : 'back' : dx < 0 ? 'right' : 'left');
          }}
          onPointerCancel={(event) => {
            clearDrag(event.pointerId, true);
          }}
          onLostPointerCapture={(event) => {
            // Ignore the old child's capture loss when transferring to the stage.
            if (activeDrag.current?.captureTarget === event.target) clearDrag(event.pointerId, true);
          }}
          onClickCapture={(event) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            // Pointer compatibility clicks have positive detail; keyboard activation is 0.
            if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
          }}>
          <div className="scene">
            {rooms.map((room) => {
              const active = room.offset === 0;
              return (
                <section key={room.key} className={`museum-room room-${active ? 'current' : room.offset < 0 ? 'previous' : 'next'}`}
                  data-room={room.number} data-fold={room.fold} data-offset={room.offset} data-depth={room.depth}
                  aria-hidden={active ? undefined : true} inert={!active || action === 'dragging'}
                  style={{ '--room-accent': room.accent } as CSSProperties}>
                  <div className="paper-left" aria-hidden="true"><span>FOLD<b>{room.number}</b></span></div>
                  <div className="paper-right" aria-hidden="true"><span>KEEP<br />LOOKING.<small>{FACES[room.facing].toUpperCase()}</small></span></div>
                  <div className="paper-floor" aria-hidden="true"><span>EPHEMERA / {room.number}</span></div>
                  <div className="paper-back">
                    <div className="wall-meta" aria-hidden="true"><span>{String(room.index + 1).padStart(2, '0')} / {EXHIBITS.length}</span><span>FOUND & KEPT</span></div>
                    <div className="exhibit-mount"><span className="mount-tape" aria-hidden="true" />
                      <button ref={active ? frame : undefined} className="artwork-frame" onClick={() => inspect(true)} aria-label={`Inspect ${room.title}`} disabled={!active || action !== 'idle'}>
                        {active && inspecting ? <span className="frame-empty" /> : <Artwork key={room.src} room={room} priority={active} />}
                        <span className="inspect-cue"><Maximize2 size={15} aria-hidden="true" /> Look closer</span>
                      </button>
                      <div className="accession-slip"><span>OBJECT {String(room.index + 1).padStart(2, '0')}</span><h2>{room.title}</h2></div>
                    </div><span className="fold-corner" aria-hidden="true" />
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <div className="navigation-area">
          <p className="navigation-note">A small thing.<br /><em>A whole other room.</em></p>
          <nav className="movement" aria-label="Walk and turn">
            <Button className="move-button" aria-label="Turn left" onClick={() => navigate('left')} disabled={action !== 'idle'}><ArrowLeft aria-hidden="true" /><span>Turn</span></Button>
            <Button className="move-button" aria-label="Previous room" onClick={() => navigateStep(-1)} disabled={action !== 'idle'}><ArrowDown aria-hidden="true" /><span>Back</span></Button>
            <Button className="move-button" aria-label="Inspect object" onClick={() => inspect(true)} disabled={action !== 'idle'}><Maximize2 aria-hidden="true" /><span>Inspect</span></Button>
            <Button className="move-button go-forward" aria-label="Next room" onClick={() => navigateStep(1)} disabled={action !== 'idle'}><ArrowUp aria-hidden="true" /><span>Walk</span></Button>
            <Button className="move-button" aria-label="Turn right" onClick={() => navigate('right')} disabled={action !== 'idle'}><ArrowRight aria-hidden="true" /><span>Turn</span></Button>
          </nav>
          <p className="navigation-instructions">Arrows / WASD to move<br />Enter to look closer</p>
        </div>
        <footer className="museum-footer"><span>FOLD. WALK. DISCOVER.</span><span className={hasMoved ? 'hint hint-used' : 'hint'}>Swipe up to walk. Sideways to turn.</span><span>THE COLLECTION CONTINUES <ArrowRight size={14} aria-hidden="true" /></span></footer>
        <p className="sr-only" role="status">Room {current.number}, facing {FACES[position.facing]}. {current.title}.</p>
      </main>
      {inspecting && (
        <DialogContent className="inspection" showCloseButton={false} finalFocus={frame}>
          <div className="inspection-bar"><span>OBJECT {String(current.index + 1).padStart(2, '0')} / {EXHIBITS.length}</span><DialogClose render={<Button className="inspection-close" />}><X size={18} aria-hidden="true" /> Back to room</DialogClose></div>
          <div className="inspection-image"><Artwork key={current.src} room={current} priority /></div>
          <div className="inspection-caption"><DialogTitle>{current.title}</DialogTitle><DialogDescription>Room {current.number} / {FACES[position.facing]}</DialogDescription></div>
        </DialogContent>
      )}
    </Dialog>
  );
}
