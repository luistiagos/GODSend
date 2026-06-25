import { createHash } from "crypto";

export type DeviceSafetyCode =
  | "NOT_USB"
  | "BOOT_OR_SYSTEM"
  | "WINDOWS_VOLUME"
  | "DISK_ZERO"
  | "READ_ONLY"
  | "OFFLINE"
  | "AMBIGUOUS_IDENTITY"
  | "INVALID_CAPACITY"
  | "MULTIPLE_MOUNTED_PARTITIONS";

export interface PhysicalUsbDevice {
  rootPath: string;
  label: string;
  fileSystem: string;
  sizeBytes: number;
  partitionSizeBytes: number;
  freeBytes: number;
  allocationUnitBytes: number;
  diskNumber: number;
  partitionNumber: number;
  diskUniqueId: string;
  serialNumber: string;
  friendlyName: string;
  manufacturer: string;
  busType: string;
  partitionStyle: string;
  driveType: string;
  diskPath: string;
  operationalStatus: string;
  isBoot: boolean;
  isSystem: boolean;
  isReadOnly: boolean;
  isOffline: boolean;
  mountedPartitionCount: number;
}

export interface DeviceSafetyAssessment {
  allowed: boolean;
  codes: DeviceSafetyCode[];
  reasons: string[];
}

export interface SafeUsbDevice extends PhysicalUsbDevice {
  fingerprint: string;
  safety: DeviceSafetyAssessment;
}

const MIN_DEVICE_SIZE_BYTES = 1024 ** 3;

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDriveRoot(value: string): string {
  const match = value.trim().match(/^([a-z]):/i);
  return match ? `${match[1].toUpperCase()}:\\` : value.trim();
}

export function createDeviceFingerprint(device: PhysicalUsbDevice): string {
  const identity = [
    "xbox360-usb-device-v1",
    device.diskNumber,
    device.partitionNumber,
    normalized(device.diskUniqueId),
    normalized(device.serialNumber),
    normalized(device.manufacturer),
    normalized(device.friendlyName),
    normalized(device.busType),
    device.sizeBytes,
    normalizeDriveRoot(device.rootPath),
  ].join("\n");

  return createHash("sha256").update(identity, "utf8").digest("hex");
}

export function assessDeviceSafety(
  device: PhysicalUsbDevice,
  systemDrive = "C:",
): DeviceSafetyAssessment {
  const codes: DeviceSafetyCode[] = [];
  const reasons: string[] = [];
  const reject = (code: DeviceSafetyCode, reason: string) => {
    if (!codes.includes(code)) {
      codes.push(code);
      reasons.push(reason);
    }
  };

  if (normalized(device.busType) !== "usb") {
    reject("NOT_USB", "O disco físico não usa barramento USB.");
  }
  if (device.isBoot || device.isSystem) {
    reject("BOOT_OR_SYSTEM", "O Windows identifica este disco como boot ou sistema.");
  }
  if (normalizeDriveRoot(device.rootPath)[0] === normalizeDriveRoot(systemDrive)[0]) {
    reject("WINDOWS_VOLUME", "Esta unidade contém o Windows em execução.");
  }
  if (device.diskNumber === 0) {
    reject("DISK_ZERO", "O disco físico 0 nunca pode ser preparado automaticamente.");
  }
  if (device.isReadOnly) {
    reject("READ_ONLY", "O disco está marcado como somente leitura.");
  }
  if (device.isOffline) {
    reject("OFFLINE", "O disco está offline.");
  }
  if (!normalized(device.diskUniqueId) && !normalized(device.serialNumber)) {
    reject(
      "AMBIGUOUS_IDENTITY",
      "O dispositivo não fornece identificador único nem número de série suficiente para uma revalidação segura.",
    );
  }
  if (!Number.isSafeInteger(device.sizeBytes) || device.sizeBytes < MIN_DEVICE_SIZE_BYTES) {
    reject("INVALID_CAPACITY", "A capacidade física informada é inválida ou inferior a 1 GB.");
  }
  if (device.mountedPartitionCount !== 1) {
    reject(
      "MULTIPLE_MOUNTED_PARTITIONS",
      "O disco precisa possuir exatamente uma partição montada para o fluxo automático.",
    );
  }

  return { allowed: codes.length === 0, codes, reasons };
}

export function enrichDeviceSafety(
  device: PhysicalUsbDevice,
  systemDrive = "C:",
): SafeUsbDevice {
  return {
    ...device,
    fingerprint: createDeviceFingerprint(device),
    safety: assessDeviceSafety(device, systemDrive),
  };
}

export function assertDeviceStillMatches(
  expectedFingerprint: string,
  current: SafeUsbDevice,
): void {
  if (!expectedFingerprint || expectedFingerprint !== current.fingerprint) {
    throw new Error(
      "O dispositivo mudou desde a seleção. Atualize a lista e selecione novamente antes de continuar.",
    );
  }
  if (!current.safety.allowed) {
    throw new Error(`Operação bloqueada: ${current.safety.reasons.join(" ")}`);
  }
}
