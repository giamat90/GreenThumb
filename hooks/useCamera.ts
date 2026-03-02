import { useCameraPermissions } from "expo-camera";

interface UseCameraResult {
  hasPermission: boolean;
  isLoading: boolean;
  requestPermission: () => Promise<{ granted: boolean }>;
}

/**
 * Wraps expo-camera's permission hook into a stable, simple interface.
 * isLoading is true for the brief moment before the OS returns permission status.
 */
export function useCamera(): UseCameraResult {
  const [permission, requestPermission] = useCameraPermissions();

  return {
    hasPermission: permission?.granted ?? false,
    isLoading: permission === null,
    requestPermission,
  };
}
