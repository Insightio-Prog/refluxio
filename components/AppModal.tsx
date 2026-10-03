import {
  Modal,
  Platform,
  View,
  useWindowDimensions,
  type ModalProps,
} from 'react-native';

// Keep in step with PhoneFrame in app/_layout.tsx (400px frame, 8px border).
const FRAME_BREAKPOINT = 600;
const FRAME_INNER_WIDTH = 400 - 16;

/** Usable app width: the phone frame's inner width on wide web screens. */
export function useAppWidth(): number {
  const { width } = useWindowDimensions();

  return Platform.OS === 'web' && width >= FRAME_BREAKPOINT
    ? FRAME_INNER_WIDTH
    : width;
}

/**
 * Drop-in replacement for react-native's Modal.
 *
 * On native it is the normal Modal. On web, Modal renders into document.body,
 * which escapes the phone frame used by the live demo. Here it is a `fixed`
 * overlay rendered in place: the transformed phone frame acts as its containing
 * block, so the overlay fills the frame (or the whole screen when unframed).
 */
export default function AppModal(props: ModalProps) {
  if (Platform.OS !== 'web') {
    return <Modal {...props} />;
  }

  if (!props.visible) {
    return null;
  }

  return (
    <View
      style={{
        position: 'fixed' as 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      }}>
      {props.children}
    </View>
  );
}
