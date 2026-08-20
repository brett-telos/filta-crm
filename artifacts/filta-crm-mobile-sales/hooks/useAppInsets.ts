import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

export function useAppInsets() {
  const insets = useSafeAreaInsets();
  
  if (Platform.OS === 'web') {
    return {
      top: Math.max(insets.top, 67),
      bottom: Math.max(insets.bottom, 34),
      left: insets.left,
      right: insets.right,
    };
  }
  
  return insets;
}
