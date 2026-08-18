export type PreparedUsbWizardStep =
  | "checking-prepared"
  | "prepared-detected"
  | "unlock"
  | "method"
  | "usb"
  | "network";

export function readPreparedUsbDetection(result: any): boolean | null {
  if (result?.ok !== true || !Array.isArray(result.drives)) return null;
  return result.drives.some((drive: any) => drive?.alreadyPrepared === true);
}

export function nextStepAfterPreparedUsbScan(
  current: PreparedUsbWizardStep,
  hasPreparedDevice: boolean,
  detectionDismissed: boolean,
): PreparedUsbWizardStep {
  if (current === "checking-prepared") {
    return hasPreparedDevice && !detectionDismissed ? "prepared-detected" : "unlock";
  }
  if (current === "unlock" && hasPreparedDevice && !detectionDismissed) {
    return "prepared-detected";
  }
  return current;
}
