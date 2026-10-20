import { Capacitor, registerPlugin } from '@capacitor/core';

interface FileExportResult {
  saved: boolean;
  bytesWritten?: number;
}

interface FileExportPlugin {
  saveJson(options: { fileName: string; content: string }): Promise<FileExportResult>;
  saveCsv(options: { fileName: string; content: string }): Promise<FileExportResult>;
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

/**
 * Android's WebView ignores `<a download>` on blob URLs, so inside the app the CSV
 * goes through the system file picker. Returns null outside the app so the caller
 * can fall back to the browser download.
 */
export async function saveCsvWithNativePicker(
  fileName: string,
  content: string,
): Promise<FileExportResult | null> {
  if (!content) throw new Error('내보낼 CSV 내용이 비어 있습니다.');
  if (Capacitor.getPlatform() !== 'android') return null;
  const result = await FileExport.saveCsv({ fileName, content });
  if (result.saved && result.bytesWritten !== undefined && result.bytesWritten !== new TextEncoder().encode(content).length) throw new Error('저장한 파일 크기가 CSV와 다릅니다. 다시 저장해 주세요.');
  return result;
}

/**
 * Saves a CSV through the Android picker or a browser download.
 * Resolves false when the user closes the picker without saving.
 */
export async function saveCsvFile(fileName: string, content: string): Promise<boolean> {
  const nativeResult = await saveCsvWithNativePicker(fileName, content);
  if (nativeResult) return nativeResult.saved;

  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
