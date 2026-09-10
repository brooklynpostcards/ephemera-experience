'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { buildWindow, describeRoom, EXHIBITS, FACES, INITIAL, move, type Action, type Room } from '@/lib/museum';

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
  const [action, setAction] = useState<Action | 'idle'>('idle');
  const [inspecting, setInspecting] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const inspection = useRef(false);
  const reduced = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const current = describeRoom(position);
  const rooms = buildWindow(position);

  const inspect = useCallback((open: boolean) => {
    if (busy.current) return;
    inspection.current = open;
    setInspecting(open);
  }, []);

  const navigate = useCallback((next: Action) => {
    if (busy.current || inspection.current) return;
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
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reduced.current = preference.matches; };
    sync();
    preference.addEventListener('change', sync);
    return () => {
      preference.removeEventListener('change', sync);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

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
      if (next) { event.preventDefault(); navigate(next); }
      else if ((event.key === 'Enter' || event.key === ' ') && !element.closest('button, a')) {
        event.preventDefault(); inspect(true);
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [navigate, inspect]);

  useEffect(() => {
    const element = stage.current;
    let lastEvent = -Infinity, total = 0, consumed = false;
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || inspection.current || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastEvent > 240) { consumed = false; total = 0; }
      lastEvent = now;
      if (busy.current || consumed) { consumed = true; return; }
      total += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1);
      if (Math.abs(total) >= 35) { consumed = true; navigate(total < 0 ? 'forward' : 'back'); }
    }
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [navigate]);

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
            suppressClick.current = false;
            if (event.pointerType !== 'touch' || !event.isPrimary || event.clientX < 24 || event.clientX > window.innerWidth - 24) {
              pointer.current = null; return;
            }
            pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
          }}
          onPointerUp={(event) => {
            const start = pointer.current; pointer.current = null;
            if (!start || start.id !== event.pointerId) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 45) return;
            suppressClick.current = true;
            navigate(Math.abs(dy) > Math.abs(dx) ? dy < 0 ? 'forward' : 'back' : dx < 0 ? 'right' : 'left');
          }}
          onPointerCancel={() => { pointer.current = null; }}
          onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
          <div className="scene">
            {rooms.map((room) => {
              const active = room.offset === 0;
              return (
                <section key={room.key} className={`museum-room room-${active ? 'current' : room.offset < 0 ? 'previous' : 'next'}`}
                  data-room={room.number} data-fold={room.fold} aria-hidden={active ? undefined : true} inert={!active}
                  style={{ '--room-accent': room.accent } as CSSProperties}>
                  <div className="paper-left" aria-hidden="true"><span>FOLD<b>{room.number}</b></span></div>
                  <div className="paper-right" aria-hidden="true"><span>KEEP<br />LOOKING.<small>{FACES[room.facing].toUpperCase()}</small></span></div>
                  <div className="paper-floor" aria-hidden="true"><span>EPHEMERA / {room.number}</span></div>
                  <div className="paper-back">
                    <div className="wall-meta" aria-hidden="true"><span>{String(room.index + 1).padStart(2, '0')} / {EXHIBITS.length}</span><span>FOUND & KEPT</span></div>
                    <div className="exhibit-mount"><span className="mount-tape" aria-hidden="true" />
                      {active ? (
                        <button ref={frame} className="artwork-frame" onClick={() => inspect(true)} aria-label={`Inspect ${room.title}`} disabled={action !== 'idle'}>
                          {inspecting ? <span className="frame-empty" /> : <Artwork key={room.src} room={room} priority />}
                          <span className="inspect-cue"><Maximize2 size={15} aria-hidden="true" /> Look closer</span>
                        </button>
                      ) : <div className="artwork-frame"><Artwork key={room.src} room={room} /></div>}
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
            <Button className="move-button" aria-label="Previous room" onClick={() => navigate('back')} disabled={action !== 'idle'}><ArrowDown aria-hidden="true" /><span>Back</span></Button>
            <Button className="move-button" aria-label="Inspect object" onClick={() => inspect(true)} disabled={action !== 'idle'}><Maximize2 aria-hidden="true" /><span>Inspect</span></Button>
            <Button className="move-button go-forward" aria-label="Next room" onClick={() => navigate('forward')} disabled={action !== 'idle'}><ArrowUp aria-hidden="true" /><span>Walk</span></Button>
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
