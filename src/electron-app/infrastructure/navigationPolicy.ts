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

