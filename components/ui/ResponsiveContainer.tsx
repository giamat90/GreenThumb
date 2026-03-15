import { View, ViewStyle } from 'react-native';
import { useResponsive } from '@/hooks/useResponsive';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const ResponsiveContainer = ({ children, style }: Props) => {
  const { isMobile, contentMaxWidth } = useResponsive();

  return (
    <View style={[
      { flex: 1 },
      !isMobile && {
        maxWidth: contentMaxWidth,
        width: '100%',
        alignSelf: 'center',
      },
      style
    ]}>
      {children}
    </View>
  );
};
