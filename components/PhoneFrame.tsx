import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';

import { LeftPanel, RightPanel } from '@/components/SidePanels';

const FRAME_BREAKPOINT = 600;
const PHONE_WIDTH = 400;
const PHONE_MAX_HEIGHT = 860;
const PANELS_BREAKPOINT = 1200;

/**
 * On wide web screens, show the app inside a phone-shaped frame so the demo
 * looks like the mobile app. On phones / native it renders full screen.
 */
export default function PhoneFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Same tree on server and client (no remount); only styles change after mount.
  const framed = Platform.OS === 'web' && mounted && width >= FRAME_BREAKPOINT;
  const frameHeight = Math.min(PHONE_MAX_HEIGHT, height - 48);
  const showPanels = framed && width >= PANELS_BREAKPOINT;
  const frameRef = useRef<unknown>(null);

  // Desktop browsers have no touch: let people drag the screen to scroll it,
  // like swiping on a phone.
  useEffect(() => {
    if (Platform.OS !== 'web' || !framed) return;
    const el = frameRef.current as HTMLElement | null;
    if (!el) return;

    const findScroller = (start: HTMLElement | null, axis: 'x' | 'y'): HTMLElement | null => {
      let n = start;
      while (n && n !== el.parentElement) {
        const s = getComputedStyle(n);
        const can =
          axis === 'y'
            ? (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 2
            : (s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2;
        if (can) return n;
        n = n.parentElement;
      }
      return null;
    };

    let startX = 0;
    let startY = 0;
    let scY: HTMLElement | null = null;
    let scX: HTMLElement | null = null;
    let baseY = 0;
    let baseX = 0;
    let down = false;
    let dragging = false;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      scY = findScroller(t, 'y');
      scX = findScroller(t, 'x');
      if (!scY && !scX) return;
      down = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      baseY = scY?.scrollTop ?? 0;
      baseX = scX?.scrollLeft ?? 0;
    };
    const onMove = (e: MouseEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 6) {
        dragging = true;
        document.body.style.userSelect = 'none';
      }
      if (!dragging) return;
      if (scY) scY.scrollTop = baseY - dy;
      if (scX) scX.scrollLeft = baseX - dx;
      e.preventDefault();
    };
    const onUp = () => {
      if (dragging) {
        // Swallow the click that follows a drag so nothing is tapped by accident.
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 50);
      }
      down = false;
      dragging = false;
      document.body.style.userSelect = '';
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [framed]);

  return (
    <View
      style={
        framed
          ? {
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 56,
              backgroundColor: '#0b1220',
            }
          : { flex: 1 }
      }>
      {showPanels ? <LeftPanel height={frameHeight + 32} /> : null}
      <View style={framed ? { alignItems: 'center' } : { flex: 1 }}>
        <Text
          style={{
            display: framed ? 'flex' : 'none',
            color: '#64748b',
            fontSize: 12,
            letterSpacing: 1.4,
            marginBottom: 10,
            fontFamily: 'Outfit',
          }}>
          REFLUXIO · LIVE DEMO
        </Text>
        <View
          ref={frameRef as never}
          style={
            framed
              ? {
                  width: PHONE_WIDTH,
                  height: frameHeight,
                  borderRadius: 44,
                  borderWidth: 8,
                  borderColor: '#334155',
                  overflow: 'hidden',
                  backgroundColor: '#f8fafc',
                  transform: 'translateZ(0)',
                  boxShadow: '0 0 0 1px #64748b, 0 0 70px rgba(148,163,184,0.18), 0 24px 80px rgba(0,0,0,0.6)',
                }
              : { flex: 1 }
          }>
          {children}
        </View>
      </View>
      {showPanels ? <RightPanel height={frameHeight + 32} /> : null}
    </View>
  );
}
