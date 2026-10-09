import { useEffect } from "react";

/**
 * Mantém a tela parada: o elemento sob o mouse (ou no centro da tela) é
 * usado como âncora; se algo acima dele crescer/encolher sem o usuário
 * rolar, a página é compensada para que ele fique no mesmo lugar.
 */
export function ScrollStabilizer() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.overflowAnchor = "none";
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let userUntil = 0;
    let anchor: Element | null = null;
    let anchorTop = 0;
    let raf = 0;

    const pick = () => {
      const el = document.elementFromPoint(mx, my);
      anchor = el && el !== root && el !== document.body ? el : null;
      anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    };
    const markUser = () => {
      userUntil = performance.now() + 400;
    };
    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const loop = () => {
      if (performance.now() < userUntil || !anchor || !anchor.isConnected) {
        pick();
      } else {
        const delta = anchor.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
        anchorTop = anchor.getBoundingClientRect().top;
      }
      raf = requestAnimationFrame(loop);
    };

    const opts = { passive: true } as const;
    window.addEventListener("mousemove", onMove, opts);
    for (const ev of ["wheel", "touchmove", "keydown", "mousedown", "touchstart"]) {
      window.addEventListener(ev, markUser, opts);
    }
    pick();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      for (const ev of ["wheel", "touchmove", "keydown", "mousedown", "touchstart"]) {
        window.removeEventListener(ev, markUser);
      }
    };
  }, []);
  return null;
}
