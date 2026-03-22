import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

function getImageWidth(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width) => resolve(width), reject);
  });
}

/**
 * Resize and compress an image for Plant.id API.
 * - Downscales to 1000px width only if larger; keeps original size otherwise.
 * - JPEG quality 0.80 targets 400–600KB decoded, keeping the JSON body well
 *   under Supabase's 1 MB edge-function request limit (base64 adds ~33%).
 * - Returns a base64-encoded JPEG string ready to send to the API.
 *
 * Requires: npx expo install expo-image-manipulator
 */
export async function compressImage(uri: string): Promise<string> {
  const originalWidth = await getImageWidth(uri);
  console.log("[PlantID] original image width:", originalWidth, "px");

  const actions = originalWidth > 1000 ? [{ resize: { width: 1000 } }] : [];

  const result = await manipulateAsync(
    uri,
    actions,
    { compress: 0.80, format: SaveFormat.JPEG, base64: true }
  );

  if (!result.base64) {
    throw new Error("Image compression produced no output. Try again.");
  }

  // base64 string length × 0.75 = approximate decoded byte size
  const base64Kb = Math.round(result.base64.length / 1024);
  const decodedKb = Math.round(result.base64.length * 0.75 / 1024);
  console.log("[PlantID] base64 string size:", base64Kb, "KB");
  console.log("[PlantID] decoded image size:", decodedKb, "KB");

  if (decodedKb < 100) {
    console.warn("[PlantID] Warning: image may be too small for accurate identification");
  }
  if (base64Kb > 800) {
    // JSON body = base64 + wrapper bytes — flag if it risks hitting the 1 MB limit
    console.warn("[PlantID] Warning: base64 payload is large (", base64Kb, "KB), may approach edge function body limit");
  }

  return result.base64;
}
