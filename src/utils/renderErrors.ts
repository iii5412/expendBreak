/**
 * Render crashes caught by an ErrorBoundary. Kept in localStorage (last few
 * only) so they survive the reload a crash usually ends in, and included in
 * the diagnostic export.
 */
export interface RenderErrorRecord {
  at: string;
  scope: string;
  name: string;
  message: string;
  componentStack: string;
}

const RENDER_ERRORS_KEY = 'eb_render_errors';
const MAX_RECORDS = 10;

export function getRecordedRenderErrors(): RenderErrorRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RENDER_ERRORS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRenderError(scope: string, error: unknown, componentStack?: string | null, now = new Date()) {
  const record: RenderErrorRecord = {
    at: now.toISOString(),
    scope,
    name: error instanceof Error ? error.name : typeof error,
    message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    componentStack: String(componentStack || '').trim().slice(0, 2000),
  };
  try {
    const records = [...getRecordedRenderErrors(), record].slice(-MAX_RECORDS);
    localStorage.setItem(RENDER_ERRORS_KEY, JSON.stringify(records));
  } catch {
    // A full or blocked storage must not turn a caught error into another crash.
  }
  return record;
}
