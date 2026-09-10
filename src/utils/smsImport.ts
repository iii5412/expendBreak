import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Category, MerchantRule, PaymentCard, Transaction } from '../types';
import { isNativeAndroid } from './platform';

export type SmsPermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface SmsPermissionStatus {
  receiveSms: SmsPermissionState;
  readSms: SmsPermissionState;
}

export interface SmsImportStatus {
  enabled: boolean;
  baselineAt: number;
  enabledAt: number;
  lastAttemptAt: number;
  lastSuccessAt: number;
  lastScannedCount: number;
  lastCandidateCount: number;
  lastError: string | null;
  pendingCount: number;
  skipped?: boolean;
}

export interface NativeSmsMessage {
  id: string;
  sender: string;
  body: string;
  receivedAt: number;
}

interface SmsBridgePlugin {
  checkPermissions(): Promise<Partial<SmsPermissionStatus>>;
  requestPermissions(): Promise<Partial<SmsPermissionStatus>>;
  openSettings(): Promise<void>;
  setActiveProfile(options: { profileKey: string; enabled: boolean; startAtInstall?: boolean }): Promise<SmsImportStatus>;
  getStatus(options: { profileKey: string }): Promise<SmsImportStatus>;
  scanInbox(options: { profileKey: string; force?: boolean }): Promise<SmsImportStatus>;
  readPending(options: { profileKey: string }): Promise<{ messages: NativeSmsMessage[] }>;
  acknowledge(options: { profileKey: string; ids: string[] }): Promise<void>;
  clearPending(options: { profileKey: string }): Promise<void>;
  addListener(eventName: 'smsPending', listener: () => void): Promise<PluginListenerHandle>;
}

const SmsBridge = registerPlugin<SmsBridgePlugin>('SmsBridge');

export function isSmsImportAvailable() {
  return isNativeAndroid();
}

export async function getSmsPermissionStatus(): Promise<SmsPermissionStatus> {
  if (!isSmsImportAvailable()) return { receiveSms: 'denied', readSms: 'denied' };
  const result = await SmsBridge.checkPermissions();
  return {
    receiveSms: result.receiveSms || 'prompt',
    readSms: result.readSms || 'prompt',
  };
}

export async function requestSmsPermissions(): Promise<SmsPermissionStatus> {
  if (!isSmsImportAvailable()) return { receiveSms: 'denied', readSms: 'denied' };
  const current = await getSmsPermissionStatus();
  if (current.receiveSms === 'granted' && current.readSms === 'granted') return current;
  const result = await SmsBridge.requestPermissions();
  return {
    receiveSms: result.receiveSms || 'denied',
    readSms: result.readSms || 'denied',
  };
}

/** Backward-compatible helper for callers that only care about live delivery. */
export async function getSmsPermissionState(): Promise<SmsPermissionState> {
  return (await getSmsPermissionStatus()).receiveSms;
}

export async function requestSmsPermission(): Promise<SmsPermissionState> {
  return (await requestSmsPermissions()).receiveSms;
}

export async function openSmsPermissionSettings() {
  if (!isSmsImportAvailable()) return;
  await SmsBridge.openSettings();
}

export async function configureSmsImport(
  profileKey: string,
  enabled: boolean,
  startAtInstall = false,
): Promise<SmsImportStatus | null> {
  if (!isSmsImportAvailable()) return null;
  return SmsBridge.setActiveProfile({ profileKey, enabled, startAtInstall });
}

export async function getSmsImportStatus(profileKey: string): Promise<SmsImportStatus | null> {
  if (!isSmsImportAvailable()) return null;
  return SmsBridge.getStatus({ profileKey });
}

export async function scanSmsInbox(profileKey: string, force = false): Promise<SmsImportStatus | null> {
  if (!isSmsImportAvailable()) return null;
  return SmsBridge.scanInbox({ profileKey, force });
}

export async function clearPendingSms(profileKey: string) {
  if (!isSmsImportAvailable()) return;
  await SmsBridge.clearPending({ profileKey });
}

export async function readPendingSms(profileKey: string): Promise<NativeSmsMessage[]> {
  if (!isSmsImportAvailable()) return [];
  const result = await SmsBridge.readPending({ profileKey });
  return Array.isArray(result.messages) ? result.messages : [];
}

export async function acknowledgePendingSms(profileKey: string, ids: string[]) {
  if (!isSmsImportAvailable() || ids.length === 0) return;
  await SmsBridge.acknowledge({ profileKey, ids });
}

export async function subscribeToPendingSms(listener: () => void): Promise<() => void> {
  if (!isSmsImportAvailable()) return () => undefined;
  const [smsHandle, appHandle] = await Promise.all([
    SmsBridge.addListener('smsPending', listener),
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) listener();
    }),
  ]);
  return () => {
    void smsHandle.remove();
    void appHandle.remove();
  };
}

export type ParsedSmsKind = 'approval' | 'cancellation';

export interface ParsedSmsTransaction {
  kind: ParsedSmsKind;
  amount: number;
  merchant: string;
  localDate: string;
  occurredAt: string;
  issuer: string | null;
  cardLast4: string | null;
  approvalCode: string | null;
  installmentMonths: number | null;
  fingerprint: string;
}

/** A structured, local-only item waiting for the user to review it. */
export interface SmsReviewCandidate extends ParsedSmsTransaction {
  messageIds: string[];
  suggestedCategoryId: string;
  matchedCardId: string | null;
}

export interface PreparedSmsReviewQueue {
  candidates: SmsReviewCandidate[];
  /** Invalid messages and approvals that were already recorded. */
  ignoredMessageIds: string[];
}

const ISSUERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'KB국민카드', pattern: /KB\s*국민|국민카드/i },
  { name: '신한카드', pattern: /신한카드|신한\s*체크/i },
  { name: '삼성카드', pattern: /삼성카드/i },
  { name: '현대카드', pattern: /현대카드/i },
  { name: '롯데카드', pattern: /롯데카드/i },
  { name: 'NH농협카드', pattern: /NH\s*농협|농협카드/i },
  { name: 'BC카드', pattern: /BC카드|비씨카드/i },
  { name: '하나카드', pattern: /하나카드/i },
  { name: '우리카드', pattern: /우리카드/i },
  { name: '카카오페이', pattern: /카카오페이/i },
  { name: '토스', pattern: /토스(?:뱅크)?(?:카드)?/i },
];

const IGNORE_TRANSACTION = /결제예정|결제일|청구(?:금액|예정)?|명세서|이용대금|납부|자동이체|한도(?:초과|안내)?|광고|이벤트|포인트|혜택|발급|배송/;
const CANCELLATION = /취소|환불\s*완료/;
const APPROVAL = /승인|결제\s*완료|카드\s*사용|체크\s*사용/;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalDateParts(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveOccurredAt(body: string, receivedAt: number) {
  const received = new Date(Number.isFinite(receivedAt) ? receivedAt : Date.now());
  const explicit = body.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (explicit) {
    const parsed = new Date(
      Number(explicit[1]),
      Number(explicit[2]) - 1,
      Number(explicit[3]),
      Number(explicit[4] || 12),
      Number(explicit[5] || 0),
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const short = body.match(/(?:^|\s)(\d{1,2})[.\/-](\d{1,2})(?:\s+|\([^)]*\)\s*)(\d{1,2}):(\d{2})(?:\s|$)/m);
  if (!short) return received;
  let year = received.getFullYear();
  const parsed = new Date(year, Number(short[1]) - 1, Number(short[2]), Number(short[3]), Number(short[4]));
  // A late-arriving New Year message can describe December while received in January.
  if (parsed.getTime() - received.getTime() > 45 * 24 * 60 * 60 * 1000) year -= 1;
  return new Date(year, Number(short[1]) - 1, Number(short[2]), Number(short[3]), Number(short[4]));
}

function extractAmount(body: string): number {
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidates = lines.filter(line => /(?:\d{1,3}(?:,\d{3})+|\d+)\s*원/.test(line));
  const preferred = candidates.find(line => !/누적|잔액|한도|청구|포인트|캐시백|혜택/.test(line)) || candidates[0];
  const match = preferred?.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  if (!match) return 0;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function extractCardLast4(body: string): string | null {
  const patterns = [
    /(?:카드|체크|신용|법인)?\s*[*xX●ㆍ-]+\s*(\d{4})(?!\d)/,
    /(?:카드번호|카드)\s*[:：]?\s*(\d{4})(?!\d)/,
    /\((\d{4})\)\s*(?:승인|취소|사용)/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractApprovalCode(body: string): string | null {
  const match = body.match(/(?:승인번호|승인No\.?|승인\s*번호)\s*[:：]?\s*([A-Za-z0-9-]{4,20})/i);
  return match?.[1] || null;
}

function cleanMerchantLine(line: string) {
  return line
    .replace(/\[?Web발신\]?/gi, ' ')
    .replace(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[.\/-]\d{1,2}(?:\s+|\([^)]*\)\s*)\d{1,2}:\d{2}/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/(?:\d{1,3}(?:,\d{3})+|\d+)\s*원/g, ' ')
    .replace(/(?:승인번호|승인No\.?)\s*[:：]?\s*[A-Za-z0-9-]+/gi, ' ')
    .replace(/(?:누적|잔액|한도)\s*[:：]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\s*원/g, ' ')
    .replace(/일시불|할부\s*\d+개월|승인취소|결제취소|매입취소|승인|결제완료|카드사용|체크사용/g, ' ')
    .replace(/[*xX●ㆍ-]+\d{4}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[|/:·\-]+|[|/:·\-]+$/g, '')
    .trim();
}

function extractMerchant(body: string, issuer: string | null) {
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidates = lines
    .map((line, index) => ({ raw: line, cleaned: cleanMerchantLine(line), index }))
    .filter(candidate => candidate.cleaned.length >= 2 && candidate.cleaned.length <= 60)
    .filter(candidate => !ISSUERS.some(item => item.pattern.test(candidate.cleaned)))
    .filter(candidate => !/고객|회원|본인|해외|국내|문의|대표번호|누적|잔액|한도|원$|카드$/.test(candidate.cleaned))
    .map(candidate => ({
      ...candidate,
      score: candidate.index
        + (/\d{1,2}[.\/-]\d{1,2}|\d{1,2}:\d{2}/.test(candidate.raw) ? 3 : 0)
        + (/(주식회사|㈜|카페|마트|스토어|페이|택시|쿠팡|배달)/.test(candidate.cleaned) ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.cleaned || `${issuer || '카드'} 사용`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  let secondHash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    secondHash = Math.imul(secondHash, 33) ^ value.charCodeAt(index);
  }
  return `sms2_${(hash >>> 0).toString(36)}_${(secondHash >>> 0).toString(36)}`;
}

export function parseFinancialSms(message: NativeSmsMessage): ParsedSmsTransaction | null {
  const body = String(message.body || '').replace(/\u0000/g, '').trim();
  if (!body || IGNORE_TRANSACTION.test(body)) return null;
  const kind: ParsedSmsKind | null = CANCELLATION.test(body)
    ? 'cancellation'
    : APPROVAL.test(body) ? 'approval' : null;
  if (!kind) return null;

  const amount = extractAmount(body);
  if (!amount) return null;
  const issuer = ISSUERS.find(item => item.pattern.test(body))?.name || null;
  const cardLast4 = extractCardLast4(body);
  const approvalCode = extractApprovalCode(body);
  const occurred = resolveOccurredAt(body, message.receivedAt);
  const merchant = extractMerchant(body, issuer);
  const installmentMatch = body.match(/(?:할부\s*)?(\d{1,2})개월/);
  const installmentMonths = installmentMatch ? Number(installmentMatch[1]) : null;
  const localDate = toLocalDateParts(occurred);
  const minute = `${localDate}T${pad(occurred.getHours())}:${pad(occurred.getMinutes())}`;
  const identity = approvalCode
    ? `${issuer || ''}|${cardLast4 || ''}|${approvalCode}|${kind}`
    : `${issuer || ''}|${cardLast4 || ''}|${amount}|${merchant.toLowerCase()}|${minute}|${kind}|${message.id}`;

  return {
    kind,
    amount,
    merchant,
    localDate,
    occurredAt: occurred.toISOString(),
    issuer,
    cardLast4,
    approvalCode,
    installmentMonths,
    fingerprint: stableHash(identity),
  };
}

function normalizeIssuer(value: string) {
  const normalized = value.toLowerCase().replace(/카드|\s/g, '').replace('비씨', 'bc');
  return normalized.includes('국민') ? 'kb국민' : normalized;
}

export function matchPaymentCard(parsed: ParsedSmsTransaction, cards: PaymentCard[]): PaymentCard | null {
  if (parsed.cardLast4) {
    const byLast4 = cards.filter(card => card.cardLast4 === parsed.cardLast4);
    if (byLast4.length === 1) return byLast4[0];
    if (byLast4.length > 1 && parsed.issuer) {
      const issuer = normalizeIssuer(parsed.issuer);
      return byLast4.find(card => normalizeIssuer(card.cardCompany).includes(issuer)
        || issuer.includes(normalizeIssuer(card.cardCompany))) || null;
    }
  }
  if (parsed.issuer) {
    const issuer = normalizeIssuer(parsed.issuer);
    const matches = cards.filter(card => normalizeIssuer(card.cardCompany).includes(issuer)
      || issuer.includes(normalizeIssuer(card.cardCompany)));
    if (matches.length === 1) return matches[0];
  }
  return cards.length === 1 ? cards[0] : null;
}

export function resolveSmsCategory(
  merchant: string,
  categories: Category[],
  rules: MerchantRule[],
) {
  const normalized = merchant.toLowerCase();
  const rule = [...rules]
    .sort((left, right) => right.pattern.length - left.pattern.length)
    .find(item => item.pattern.trim() && normalized.includes(item.pattern.trim().toLowerCase()));
  if (rule && categories.some(category => category.id === rule.categoryId && category.type === 'expense')) {
    return rule.categoryId;
  }

  const heuristics: Array<[RegExp, string]> = [
    [/배민|배달|쿠팡이츠|요기요/, 'delivery_food'],
    [/택시|카카오모빌리티|대중교통|버스|지하철|철도|코레일|주유|충전소/, 'transportation'],
    [/병원|의원|약국|치과|한의원/, 'medical_health'],
    [/마트|슈퍼|이마트|홈플러스|롯데마트|컬리|농협/, 'groceries'],
    [/카페|커피|스타벅스|투썸|메가커피|음식|식당|레스토랑|맥도날드/, 'dining_out'],
    [/넷플릭스|유튜브|디즈니|구독|멤버십/, 'subscriptions'],
    [/통신|모바일|SKT|KT|LGU/, 'telecom'],
    [/쿠팡|스토어|백화점|쇼핑|마켓/, 'shopping'],
  ];
  for (const [pattern, categoryId] of heuristics) {
    if (pattern.test(merchant) && categories.some(category => category.id === categoryId && category.active)) {
      return categoryId;
    }
  }
  return categories.find(category => category.id === 'etc_expense')?.id
    || categories.find(category => category.type === 'expense' && category.active)?.id
    || '';
}

export function isDuplicateSmsTransaction(parsed: ParsedSmsTransaction, transactions: Transaction[]) {
  return transactions.some(transaction => transaction.sourceFingerprint === parsed.fingerprint);
}

export function findCancellationTarget(
  parsed: ParsedSmsTransaction,
  transactions: Transaction[],
  cardId: string | null,
) {
  const cancellationTime = new Date(parsed.occurredAt).getTime();
  const merchant = parsed.merchant.toLowerCase().replace(/\s/g, '');
  const matches = transactions.filter(transaction => {
    if (transaction.source !== 'sms' || transaction.type !== 'expense' || transaction.amount !== parsed.amount) return false;
    if (cardId && transaction.cardId && transaction.cardId !== cardId) return false;
    const transactionTime = new Date(transaction.occurredAt).getTime();
    if (!Number.isFinite(transactionTime) || transactionTime > cancellationTime
      || cancellationTime - transactionTime > 45 * 24 * 60 * 60 * 1000) return false;
    if (parsed.approvalCode && transaction.sourceReference === parsed.approvalCode) return true;
    const candidateMerchant = transaction.merchant.toLowerCase().replace(/\s/g, '');
    return merchant === candidateMerchant || merchant.includes(candidateMerchant) || candidateMerchant.includes(merchant);
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Converts the private native queue to review candidates without recording a
 * transaction. Duplicate messages are grouped behind one review action.
 */
export function prepareSmsReviewQueue(
  messages: NativeSmsMessage[],
  transactions: Transaction[],
  cards: PaymentCard[],
  categories: Category[],
  rules: MerchantRule[],
): PreparedSmsReviewQueue {
  const candidatesByFingerprint = new Map<string, SmsReviewCandidate>();
  const ignoredMessageIds: string[] = [];

  messages.forEach(message => {
    const parsed = parseFinancialSms(message);
    if (!parsed || (parsed.kind === 'approval' && isDuplicateSmsTransaction(parsed, transactions))) {
      ignoredMessageIds.push(message.id);
      return;
    }

    const existing = candidatesByFingerprint.get(parsed.fingerprint);
    if (existing) {
      existing.messageIds.push(message.id);
      return;
    }

    const card = matchPaymentCard(parsed, cards);
    candidatesByFingerprint.set(parsed.fingerprint, {
      ...parsed,
      messageIds: [message.id],
      suggestedCategoryId: parsed.kind === 'approval'
        ? resolveSmsCategory(parsed.merchant, categories, rules)
        : '',
      matchedCardId: card?.id || null,
    });
  });

  return {
    candidates: [...candidatesByFingerprint.values()]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    ignoredMessageIds,
  };
}
