import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

/**
 * Resize and compress an image to stay within Plant.id's recommended 2MP limit.
 * Resizes the longest side to max 1200px (aspect ratio preserved), JPEG quality 0.8.
 * Returns a base64-encoded JPEG string ready to send to the API.
 *
 * Requires: npx expo install expo-image-manipulator
 */
export async function compressImage(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.8, format: SaveFormat.JPEG, base64: true }
  );

  if (!result.base64) {
    throw new Error("Image compression produced no output. Try again.");
  }

  return result.base64;
}
