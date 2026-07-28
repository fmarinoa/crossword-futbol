import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlacedEntry, Rect } from '../state/types';
import './ZoomOverlay.css';

interface ZoomOverlayProps {
  entry: PlacedEntry;
  revealedCells: Map<string, string>;
  initialRect: Rect | null;
  wasWrong: boolean;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export default function ZoomOverlay({
  entry,
  revealedCells,
  initialRect,
  wasWrong,
  submitting,
  submitError,
  onSubmit,
  onClose,
}: ZoomOverlayProps) {
  const prefilled = entry.cellRefs.map((cell) => revealedCells.get(`${cell.row},${cell.col}`) ?? null);
  const [letters, setLetters] = useState<string[]>(prefilled.map((l) => l ?? ''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [shake, setShake] = useState(false);
  const [prevWasWrong, setPrevWasWrong] = useState(wasWrong);
  if (wasWrong !== prevWasWrong) {
    setPrevWasWrong(wasWrong);
    if (wasWrong) setShake(true);
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !initialRect) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const finalRect = panel.getBoundingClientRect();
    const dx = initialRect.left + initialRect.width / 2 - (finalRect.left + finalRect.width / 2);
    const dy = initialRect.top + initialRect.height / 2 - (finalRect.top + finalRect.height / 2);

    panel.style.transition = 'none';
    panel.style.transform = `translate(${dx}px, ${dy}px)`;
    panel.style.opacity = '0.4';
    requestAnimationFrame(() => {
      panel.style.transition = 'transform 320ms ease-out, opacity 220ms ease-out';
      panel.style.transform = 'translate(0, 0)';
      panel.style.opacity = '1';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const firstEditable = letters.findIndex((_, i) => prefilled[i] === null);
    const target = firstEditable === -1 ? 0 : firstEditable;
    inputRefs.current[target]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shake) return;
    const timeout = setTimeout(() => setShake(false), 420);
    return () => clearTimeout(timeout);
  }, [shake]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function setLetterAt(index: number, value: string) {
    setLetters((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleChange(index: number, raw: string) {
    if (prefilled[index] !== null || submitting) return;
    const char = raw.slice(-1).toUpperCase();
    setLetterAt(index, char);
    if (char) {
      const next = nextEditableIndex(index);
      if (next !== -1) inputRefs.current[next]?.focus();
    }
  }

  function nextEditableIndex(from: number) {
    for (let i = from + 1; i < entry.length; i++) {
      if (prefilled[i] === null) return i;
    }
    return -1;
  }

  function prevEditableIndex(from: number) {
    for (let i = from - 1; i >= 0; i--) {
      if (prefilled[i] === null) return i;
    }
    return -1;
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !letters[index]) {
      const prev = prevEditableIndex(index);
      if (prev !== -1) {
        setLetterAt(prev, '');
        inputRefs.current[prev]?.focus();
      }
    } else if (e.key === 'Enter') {
      if (!submitting) handleSubmit();
    } else if (e.key === 'ArrowRight') {
      const next = nextEditableIndex(index);
      if (next !== -1) inputRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      const prev = prevEditableIndex(index);
      if (prev !== -1) inputRefs.current[prev]?.focus();
    }
  }

  function handleSubmit() {
    onSubmit(letters.join(''));
  }

  const orientationLabel = entry.orientation === 'H' ? 'Horizontal' : 'Vertical';

  return (
    <div className="zoom-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={`zoom-panel ${shake ? 'zoom-panel--shake' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Entrada ${entry.number} ${orientationLabel}`}
      >
        <button type="button" className="zoom-panel__close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>

        <p className="zoom-panel__meta">
          {entry.number} · {orientationLabel}
        </p>
        <p className="zoom-panel__clue">{entry.clue}</p>

        <div className="zoom-panel__boxes">
          {entry.cellRefs.map((_, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              className={`zoom-panel__box ${prefilled[i] !== null ? 'zoom-panel__box--locked' : ''}`}
              value={letters[i]}
              maxLength={1}
              disabled={prefilled[i] !== null || submitting}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              inputMode="text"
              autoComplete="off"
              aria-label={`Letra ${i + 1} de ${entry.length}`}
            />
          ))}
        </div>

        {wasWrong && <p className="zoom-panel__feedback">Respuesta incorrecta, probá de nuevo</p>}
        {submitError && <p className="zoom-panel__feedback">No se pudo enviar, reintentá ({submitError})</p>}

        <button type="button" className="zoom-panel__submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Enviando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
