/**
 * Browser-safe identity comparison for a USB device selected in the UI across
 * an automatic refresh right when the user clicks "Preparar pendrive/HD".
 *
 * Formatting the same physical drive (either in Windows Explorer or by a prior
 * failed run) rotates `volumeGuid` and `fileSystem`, which rotates the full
 * `fingerprint`. Comparing hardware identity keeps same-drive retries seamless
 * while still blocking silently swapped drives at the same drive letter.
 */

export interface UsbSelectionIdentity {
  rootPath?: string;
  fingerprint?: string;
  diskNumber?: number;
  diskUniqueId?: string;
  serialNumber?: string;
  volumeGuid?: string;
  friendlyName?: string;
  sizeBytes?: number;
}

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normRoot(value: unknown): string {
  const match = String(value ?? "").trim().match(/^([a-z]):/i);
  return match ? `${match[1].toUpperCase()}:\\` : norm(value);
}

/**
 * Returns true when `current` represents the same physical USB device that the
 * user already had selected in `previous`, even if its partition was reformatted.
 */
export function isSamePhysicalUsbSelection(
  previous?: UsbSelectionIdentity | null,
  current?: UsbSelectionIdentity | null,
): boolean {
  if (!previous || !current) return false;
  if (!normRoot(previous.rootPath) || normRoot(previous.rootPath) !== normRoot(current.rootPath)) {
    return false;
  }

  if (previous.fingerprint && current.fingerprint && previous.fingerprint === current.fingerprint) {
    return true;
  }

  // Native DriveInfo+mountvol rows (diskNumber === -1) carry no hardware serial/uniqueId,
  // only volumeGuid — match by volumeGuid so native<->physical transitions stay seamless
  // without risking a swapped formatted pendrive at the same drive letter.
  if (previous.diskNumber === -1 || current.diskNumber === -1) {
    const prevVol = norm(previous.volumeGuid);
    const currVol = norm(current.volumeGuid);
    return Boolean(prevVol && currVol && prevVol === currVol);
  }

  const prevName = norm(previous.friendlyName);
  const currName = norm(current.friendlyName);
  if (prevName && currName && prevName !== currName) {
    return false;
  }

  const prevSize = Number(previous.sizeBytes || 0);
  const currSize = Number(current.sizeBytes || 0);
  if (prevSize > 0 && currSize > 0) {
    const tolerance = Math.max(16 * 1024 ** 2, Math.floor(prevSize * 0.01));
    if (Math.abs(currSize - prevSize) > tolerance) {
      return false;
    }
  }

  const prevUnique = norm(previous.diskUniqueId);
  const currUnique = norm(current.diskUniqueId);
  if (prevUnique && currUnique && prevUnique !== currUnique) {
    return false;
  }

  const prevSerial = norm(previous.serialNumber);
  const currSerial = norm(current.serialNumber);
  if (prevSerial && currSerial && prevSerial !== currSerial) {
    return false;
  }

  return Boolean(
    (prevUnique && currUnique && prevUnique === currUnique) ||
      (prevSerial && currSerial && prevSerial === currSerial),
  );
}
