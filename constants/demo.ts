import { Platform } from 'react-native';

/** The browser build is the public demo: sample data, no camera, limited AI. */
export const IS_DEMO = Platform.OS === 'web';
