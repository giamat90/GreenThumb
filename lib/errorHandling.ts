import NetInfo from "@react-native-community/netinfo";

// ─── Network ──────────────────────────────────────────────────────────────────

export const isConnected = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
};

// ─── Error classifier ─────────────────────────────────────────────────────────

export type AppErrorType =
  | "no_internet"
  | "ai_unavailable"
  | "photo_upload"
  | "auth_expired"
  | "database"
  | "unknown";

export const classifyError = (error: unknown): AppErrorType => {
  const msg =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (msg.includes("network") || msg.includes("fetch") || msg.includes("network request failed"))
    return "no_internet";
  if (msg.includes("jwt") || msg.includes("unauthorized") || msg.includes("401"))
    return "auth_expired";
  if (msg.includes("anthropic") || msg.includes("edge function") || msg.includes("analysis failed"))
    return "ai_unavailable";
  if (msg.includes("storage") || msg.includes("upload"))
    return "photo_upload";
  if (msg.includes("supabase") || msg.includes("pgrst") || msg.includes("database"))
    return "database";
  return "unknown";
};

// ─── Error messages ───────────────────────────────────────────────────────────

export interface ErrorMessage {
  title: string;
  desc: string;
  action: string;
}

export const getErrorMessage = (type: AppErrorType, t: (key: string) => string): ErrorMessage => {
  switch (type) {
    case "no_internet":
      return {
        title: t("errors.noInternet"),
        desc: t("errors.noInternetDesc"),
        action: t("errors.checkConnection"),
      };
    case "auth_expired":
      return {
        title: t("errors.sessionExpired"),
        desc: t("errors.sessionExpiredDesc"),
        action: t("errors.signInAgain"),
      };
    case "ai_unavailable":
      return {
        title: t("errors.aiUnavailable"),
        desc: t("errors.aiUnavailableDesc"),
        action: t("errors.tryAgain"),
      };
    case "photo_upload":
      return {
        title: t("errors.photoUploadFailed"),
        desc: t("errors.photoUploadFailedDesc"),
        action: t("errors.tryAgain"),
      };
    case "database":
      return {
        title: t("errors.databaseError"),
        desc: t("errors.databaseErrorDesc"),
        action: t("errors.tryAgain"),
      };
    default:
      return {
        title: t("errors.somethingWentWrong"),
        desc: t("errors.somethingWentWrongDesc"),
        action: t("errors.tryAgain"),
      };
  }
};

// ─── Error action ─────────────────────────────────────────────────────────────

export const getErrorAction = (type: AppErrorType): "open_settings" | "retry" => {
  if (type === "no_internet") return "open_settings";
  return "retry";
};

// ─── Retry helper ─────────────────────────────────────────────────────────────

export const fetchWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  // TypeScript requires an explicit throw here even though the loop always throws or returns
  throw new Error("fetchWithRetry: exhausted retries");
};
