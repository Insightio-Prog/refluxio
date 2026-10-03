import { useEffect, useState, type ReactNode } from 'react';
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
          style={
            framed
              ? {
                  width: PHONE_WIDTH,
                  height: frameHeight,
                  borderRadius: 44,
                  borderWidth: 8,
                  borderColor: '#1e293b',
                  overflow: 'hidden',
                  backgroundColor: '#f8fafc',
                  transform: 'translateZ(0)',
                  boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
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
