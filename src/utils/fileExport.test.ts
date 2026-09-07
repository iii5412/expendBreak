import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ platform: 'android', saveJson: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => native.platform }, registerPlugin: () => ({ saveJson: native.saveJson }) }));
import { saveJsonWithNativePicker } from './fileExport';
describe('diagnostic file saving', () => {
  beforeEach(() => { native.platform = 'android'; native.saveJson.mockReset(); });
  it('rejects invalid or empty JSON before opening a picker', async () => {
    await expect(saveJsonWithNativePicker('data.json', '')).rejects.toThrow();
    await expect(saveJsonWithNativePicker('data.json', '[]')).rejects.toThrow();
    expect(native.saveJson).not.toHaveBeenCalled();
  });
  it('verifies UTF-8 byte size, including Korean text', async () => {
    const content = JSON.stringify({ month: '구월' });
    const bytesWritten = new TextEncoder().encode(content).length;
    native.saveJson.mockResolvedValue({ saved: true, bytesWritten });
    expect(await saveJsonWithNativePicker('data.json', content)).toEqual({ saved: true, bytesWritten });
    native.saveJson.mockResolvedValue({ saved: true, bytesWritten: 0 });
    await expect(saveJsonWithNativePicker('data.json', content)).rejects.toThrow('크기');
  });
  it('distinguishes cancellation and browser fallback from successful saving', async () => {
    native.saveJson.mockResolvedValue({ saved: false });
    expect(await saveJsonWithNativePicker('data.json', '{}')).toEqual({ saved: false });
    native.platform = 'web';
    expect(await saveJsonWithNativePicker('data.json', '{}')).toBeNull();
  });
});
