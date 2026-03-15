import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  mobile: 768,
  desktop: 1024,
};

export const useResponsive = () => {
  const { width, height } = useWindowDimensions();
  const isMobile = width < BREAKPOINTS.mobile;
  const isDesktop = width >= BREAKPOINTS.desktop;

  // Adaptive max width: 75% of screen, capped at 1200px
  // On mobile: full width
  const contentMaxWidth = isMobile
    ? width
    : Math.min(width * 0.75, 1200);

  return {
    isMobile,
    isTablet: !isMobile && !isDesktop,
    isDesktop,
    width,
    height,
    contentMaxWidth,
  };
};
