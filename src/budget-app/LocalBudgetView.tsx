import { transactionsCsv } from '../utils/transactionCsv';
import { useEffect, useMemo, useState } from 'react';
import { AccountBudgetView, type BudgetAccountActions } from './AccountBudgetView';
import { budgetWithSettings, transactionForStorage, type BudgetAccountData } from './adapter';
import {
  emptyLocalAccount,
  ensureLocalOccurrences,
  postLocalOccurrence,
  putLocalTemplate,
  setupLocalAccount,
} from './localAccount';
import { newOperationId } from '../utils/amountOperations';
import { configurePaydaySchedule } from '../utils/paydaySchedule';
import { BudgetMerchantRule } from '../lib/budgetAi';

const KEY = 'eb_budget_local_preview_v1';
function read() {
  const raw = localStorage.getItem(KEY);
  const data: BudgetAccountData = raw ? JSON.parse(raw) : emptyLocalAccount();
  if (
    !data.profile ||
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.templates) ||
    !Array.isArray(data.occurrences) ||
    !data.budget ||
    !Array.isArray(data.categories)
  )
    throw new Error('로컬 체험 데이터를 읽지 못했습니다. 저장한 데이터는 유지됩니다.');
  configurePaydaySchedule(data.profile.paydaySchedule, {
    monthStartDay: data.profile.monthStartDay,
    cycleStartOverrides: data.profile.cycleStartOverrides,
  });
  return ensureLocalOccurrences(data);
}

export function LocalBudgetView() {
  const [account, setAccount] = useState(read);
  const actions = useMemo<BudgetAccountActions>(() => {
    const commit = (change: (data: BudgetAccountData) => BudgetAccountData) => {
      const next = change(read());
      localStorage.setItem(KEY, JSON.stringify(next));
      setAccount(next);
    };
    return {
      exportCsv: async () => {
        const data = read();
        return transactionsCsv(data.transactions, data.categories);
      },
      resetData: async () =>
        commit(() => {
          const data = emptyLocalAccount();
          return { ...data, profile: { ...data.profile, onboardingCompletedAt: new Date().toISOString() } };
        }),
      saveAiSettings: async (classification, insights) =>
        commit((data) => ({
          ...data,
          profile: {
            ...data.profile,
            aiClassificationEnabled: classification,
            aiInsightsEnabled: insights,
            aiConsentAt: classification || insights ? new Date().toISOString() : null,
          },
        })),
      saveRule: async (pattern, categoryId) => {
        const rule = BudgetMerchantRule.parse({ pattern, categoryId });
        commit((data) => ({
          ...data,
          merchantRules: [
            ...(data.merchantRules || []).filter(
              (item) => item.pattern.toLocaleLowerCase() !== pattern.toLocaleLowerCase(),
            ),
            { ...rule, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        }));
      },
      saveTransaction: async (transaction) =>
        commit((data) => ({
          ...data,
          transactions: [
            ...data.transactions,
            {
              ...transactionForStorage(transaction),
              id: transaction.id,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        })),
      saveSettings: async (settings) =>
        commit((data) => ({ ...data, budget: budgetWithSettings(data.budget, settings) })),
      saveTemplate: async (template, id) => commit((data) => putLocalTemplate(data, template, id)),
      archive: async (id) =>
        commit((data) => ({
          ...data,
          templates: data.templates.map((t) => (t.id === id ? { ...t, archivedAt: new Date().toISOString() } : t)),
        })),
      post: async (id, amount) => commit((data) => postLocalOccurrence(data, id, amount)),
      skip: async (id) =>
        commit((data) => ({
          ...data,
          occurrences: data.occurrences.map((o) =>
            o.id === id && o.status !== 'posted' && o.status !== 'skipped'
              ? {
                  ...o,
                  status: 'skipped',
                  revision: (o.revision || 0) + 1,
                  lastOperationId: newOperationId(),
                  updatedAt: new Date().toISOString(),
                }
              : o,
          ),
        })),
      completeSetup: async (setup) => commit((data) => setupLocalAccount(data, setup)),
      skipSetup: async () =>
        commit((data) => ({ ...data, profile: { ...data.profile, onboardingCompletedAt: new Date().toISOString() } })),
    };
  }, []);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === KEY) setAccount(read());
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  return (
    <AccountBudgetView
      account={account}
      actions={actions}
      isDemo
      accountContent={
        <section className="bb-card">
          <h2>로컬 체험 계정</h2>
          <p className="bb-caption">
            로그인 없이 정기 항목과 초기 설정을 확인할 수 있습니다. 이 기록은 Firebase로 전송하지 않습니다.
          </p>
          <a className="bb-text-link" href="/?view=budget">
            실제 계정 화면으로 이동
          </a>
        </section>
      }
    />
  );
}
