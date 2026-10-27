// Official Microsoft link for the offline system update (redirects to SystemUpdate_17559_USB.zip).
export const XBOX360_SYSTEM_UPDATE_USB_URL = "https://www.xbox.com/system-update-usb";

const ALLOWED_EXTERNAL_LINKS = new Set([XBOX360_SYSTEM_UPDATE_USB_URL]);

/** Links the renderer may open in the user's browser: exact URLs only, never a prefix or a host. */
export function isAllowedExternalLink(targetUrl: string): boolean {
  return ALLOWED_EXTERNAL_LINKS.has(targetUrl);
}

export function isAllowedApplicationNavigation(
  targetUrl: string,
  currentUrl: string,
  developmentServerUrl?: string,
): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (developmentServerUrl) {
    try {
      const developmentOrigin = new URL(developmentServerUrl).origin;
      return target.origin === developmentOrigin && (target.protocol === "http:" || target.protocol === "https:");
    } catch {
      return false;
    }
  }

  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    return false;
  }
  return (
    target.protocol === "file:" &&
    current.protocol === "file:" &&
    target.origin === current.origin &&
    target.pathname === current.pathname
  );
}

