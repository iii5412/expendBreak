import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { BudgetAlertLevel, UserProfile, WidgetPrivacyMode } from '../types';
import { isNativeAndroid } from './platform';

export interface WidgetSnapshotV1 {
  schemaVersion: 1;
  periodYM: string;
  periodEndDate: string;
  remainingAllowance: number;
  confirmedVariableExpenses: number;
  spendableLimit: number;
  dailySafeAllowance: number;
  daysRemaining: number;
  alertLevel: BudgetAlertLevel;
  calculatedAt: string;
  visibleUntil: string | null;
  privacyMode: WidgetPrivacyMode;
}
interface WidgetBridgePlugin {
  publishSnapshot(options: { snapshot: WidgetSnapshotV1 }): Promise<void>;
  setLocked(options: { locked: boolean }): Promise<void>;
  requestPin(): Promise<{ supported: boolean; requested: boolean }>;
  refresh(): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

export interface WidgetSummarySource {
  remainingAllowance: number;
  confirmedVariableExpenses: number;
  spendableLimit: number;
  dailySafeAllowance: number;
  daysRemaining: number;
  alertLevel: BudgetAlertLevel;
}

export function normalizeWidgetPrivacyMode(value: unknown): WidgetPrivacyMode {
  return value === 'always_show' || value === 'amounts_hidden' ? value : 'unlock_required';
}

export function buildWidgetSnapshot(
  periodYM: string,
  periodEndDate: string,
  summary: WidgetSummarySource,
  profile: Pick<UserProfile, 'idleLockMinutes' | 'widgetPrivacyMode'>,
  now = new Date(),
): WidgetSnapshotV1 {
  const idleMinutes = Number(profile.idleLockMinutes);
  const visibleUntil = normalizeWidgetPrivacyMode(profile.widgetPrivacyMode) === 'unlock_required'
    && Number.isFinite(idleMinutes)
    && idleMinutes > 0
    ? new Date(now.getTime() + idleMinutes * 60_000).toISOString()
    : null;

  return {
    schemaVersion: 1,
    periodYM,
    periodEndDate,
    remainingAllowance: Math.round(summary.remainingAllowance),
    confirmedVariableExpenses: Math.round(summary.confirmedVariableExpenses),
    spendableLimit: Math.round(summary.spendableLimit),
    dailySafeAllowance: Math.round(summary.dailySafeAllowance),
    daysRemaining: Math.max(0, Math.trunc(summary.daysRemaining)),
    alertLevel: summary.alertLevel,
    calculatedAt: now.toISOString(),
    visibleUntil,
    privacyMode: normalizeWidgetPrivacyMode(profile.widgetPrivacyMode),
  };
}

let lastPublishedSnapshot = '';

export async function publishWidgetSnapshot(snapshot: WidgetSnapshotV1): Promise<void> {
  if (!isNativeAndroid()) return;
  const serialized = JSON.stringify(snapshot);
  if (serialized === lastPublishedSnapshot) return;
  await WidgetBridge.publishSnapshot({ snapshot });
  lastPublishedSnapshot = serialized;
}

export async function setWidgetLocked(locked: boolean): Promise<void> {
  if (!isNativeAndroid()) return;
  await WidgetBridge.setLocked({ locked });
  if (locked) lastPublishedSnapshot = '';
}

export async function requestWidgetPin(): Promise<{ supported: boolean; requested: boolean }> {
  if (!isNativeAndroid()) return { supported: false, requested: false };
  return WidgetBridge.requestPin();
}

export async function refreshWidgets(): Promise<void> {
  if (!isNativeAndroid()) return;
  await WidgetBridge.refresh();
}

export type NativeDestination = 'home' | 'transaction/new' | 'settings/widget';

export function parseNativeDestination(url: string): NativeDestination | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'expendbreak:') return null;
    const destination = `${parsed.host}${parsed.pathname}`.replace(/^\/+|\/+$/g, '');
    return destination === 'home' || destination === 'transaction/new' || destination === 'settings/widget'
      ? destination
      : null;
  } catch {
    return null;
  }
}

export async function subscribeToNativeDestinations(
  listener: (destination: NativeDestination) => void,
): Promise<() => void> {
  if (!isNativeAndroid()) return () => undefined;

  const launch = await App.getLaunchUrl();
  const initialDestination = launch?.url ? parseNativeDestination(launch.url) : null;
  if (initialDestination) listener(initialDestination);

  const handle = await App.addListener('appUrlOpen', ({ url }) => {
    const destination = parseNativeDestination(url);
    if (destination) listener(destination);
  });
  return () => void handle.remove();
}
