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
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('진단 데이터 형식이 올바르지 않습니다.');
  if (Capacitor.getPlatform() !== 'android') return null;
  const result = await FileExport.saveJson({ fileName, content });
  if (result.saved && result.bytesWritten !== undefined && result.bytesWritten !== new TextEncoder().encode(content).length) throw new Error('저장한 파일 크기가 진단 데이터와 다릅니다. 다시 저장해 주세요.');
  return result;
}
