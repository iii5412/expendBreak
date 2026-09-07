import { Capacitor, registerPlugin } from '@capacitor/core';

interface FileExportResult {
  saved: boolean;
  bytesWritten?: number;
}

interface FileExportPlugin {
  saveJson(options: { fileName: string; content: string }): Promise<FileExportResult>;
}

const FileExport = registerPlugin<FileExportPlugin>('FileExport');

/**
 * Opens Android's system file picker and writes the JSON to the location the
 * user selected. Returns null outside the Android app so the browser can use
 * its normal download flow.
 */
export async function saveJsonWithNativePicker(
  fileName: string,
  content: string,
): Promise<FileExportResult | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  return FileExport.saveJson({ fileName, content });
}
