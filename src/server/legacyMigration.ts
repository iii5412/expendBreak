import type { RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';

const MARKER_ID = 'legacy-root-v1';
const FAILURE_MARKER_ID = 'legacy-root-v1-failed';
const BATCH_SIZE = 400;

export const LEGACY_COLLECTIONS = [
  'appSettings',
  'transactions',
  'categories',
  'budgets',
  'recurringTemplates',
  'recurringOccurrences',
  'merchantRules',
  'bankAccounts',
  'paymentCards',
] as const;

type CollectionReport = {
  sourceCount: number;
  copied: number;
  skippedExisting: number;
  destinationCount: number;
  sourceAmountTotal?: number;
  destinationAmountTotal?: number;
};

export type MigrationFailure = {
  collection: string;
  reason: 'missing_documents' | 'amount_mismatch';
  missingIds?: string[];
  sourceAmountTotal?: number;
  destinationAmountTotal?: number;
};

/** The copy ran but its result does not match the source; nothing may be marked complete. */
export class MigrationVerificationError extends Error {
  constructor(message: string, readonly failure: MigrationFailure) {
    super(message);
    this.name = 'MigrationVerificationError';
  }
}

function prepareForOwner(collectionName: string, source: Record<string, unknown>) {
  const data = { ...source };
  if (collectionName === 'appSettings') {
    delete data.accessPin;
    data.aiClassificationEnabled = false;
    data.aiInsightsEnabled = false;
    data.aiConsentAt = null;
  }
  return data;
}

const amountTotal = (documents: Array<Record<string, unknown> | undefined>) =>
  documents.reduce((sum, document) => sum + Number(document?.amount || 0), 0);

/**
 * Copies the legacy root collections under `users/{ownerUid}`. It never deletes
 * the source and never overwrites a document that already exists at the
 * destination, so re-running after a lost marker cannot undo the user's edits.
 */
export async function ensureLegacyDataMigration(
  getDb: () => Firestore,
  ownerUid: string,
  { now = () => new Date() }: { now?: () => Date } = {},
) {
  let adminDb: Firestore;
  try {
    adminDb = getDb();
  } catch {
    // Local development without Admin credentials cannot run the migration at all.
    return {
      version: MARKER_ID,
      ownerUid,
      completedAt: now().toISOString(),
      skipped: true,
      reason: 'admin_db_unavailable',
    };
  }

  const ownerRef = adminDb.collection('users').doc(ownerUid);
  const markerRef = ownerRef.collection('migrations').doc(MARKER_ID);
  const existingMarker = await markerRef.get();
  if (existingMarker.exists) return existingMarker.data();

  const collectionReports: Record<string, CollectionReport> = {};
  const sourceDataByCollection = new Map<string, Array<Record<string, unknown>>>();

  const failVerification = async (message: string, failure: MigrationFailure) => {
    await ownerRef.collection('migrations').doc(FAILURE_MARKER_ID).set({
      version: MARKER_ID,
      ownerUid,
      failedAt: now().toISOString(),
      message,
      failure,
      collections: collectionReports,
    });
    throw new MigrationVerificationError(message, failure);
  };

  for (const collectionName of LEGACY_COLLECTIONS) {
    const sourceDocs = (await adminDb.collection(collectionName).get()).docs;
    sourceDataByCollection.set(collectionName, sourceDocs.map(document => ({ id: document.id, ...document.data() })));

    const destination = ownerRef.collection(collectionName);
    const existingIds = new Set((await destination.get()).docs.map(document => document.id));
    const toCopy = sourceDocs.filter(document => !existingIds.has(document.id));

    for (let offset = 0; offset < toCopy.length; offset += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const sourceDoc of toCopy.slice(offset, offset + BATCH_SIZE)) {
        // create() fails instead of overwriting if a document appeared since the read above.
        batch.create(destination.doc(sourceDoc.id), prepareForOwner(collectionName, sourceDoc.data()));
      }
      await batch.commit();
    }

    const destinationSnapshot = await destination.get();
    const destinationById = new Map(destinationSnapshot.docs.map(document => [document.id, document.data()]));
    const report: CollectionReport = {
      sourceCount: sourceDocs.length,
      copied: toCopy.length,
      skippedExisting: sourceDocs.length - toCopy.length,
      destinationCount: destinationSnapshot.size,
    };
    collectionReports[collectionName] = report;

    const missingIds = sourceDocs.filter(document => !destinationById.has(document.id)).map(document => document.id);
    if (missingIds.length > 0) {
      await failVerification(
        `${collectionName} migration verification failed: ${missingIds.length} document(s) missing`,
        { collection: collectionName, reason: 'missing_documents', missingIds },
      );
    }

    if (collectionName === 'transactions') {
      // Only freshly copied documents are compared: a pre-existing one may carry the user's edits.
      report.sourceAmountTotal = amountTotal(toCopy.map(document => document.data()));
      report.destinationAmountTotal = amountTotal(toCopy.map(document => destinationById.get(document.id)));
      if (report.sourceAmountTotal !== report.destinationAmountTotal) {
        await failVerification('transactions migration verification failed: amount totals differ', {
          collection: collectionName,
          reason: 'amount_mismatch',
          sourceAmountTotal: report.sourceAmountTotal,
          destinationAmountTotal: report.destinationAmountTotal,
        });
      }
    }
  }

  const categoryTypeById = new Map(
    (sourceDataByCollection.get('categories') || []).map(category => [category.id, category.type]),
  );
  const invalidTransactions = (sourceDataByCollection.get('transactions') || []).filter(
    transaction => categoryTypeById.get(transaction.categoryId) !== transaction.type,
  );
  const invalidTemplates = (sourceDataByCollection.get('recurringTemplates') || []).filter(
    template => categoryTypeById.get(template.categoryId) !== template.type,
  );
  const report = {
    version: MARKER_ID,
    ownerUid,
    completedAt: now().toISOString(),
    sourceDeleted: false,
    collections: collectionReports,
    classificationIssues: {
      transactionCount: invalidTransactions.length,
      transactionAmount: amountTotal(invalidTransactions),
      recurringTemplateCount: invalidTemplates.length,
    },
  };
  await markerRef.set(report);
  return report;
}

export function createMigrationHandler({
  ownerUid,
  run,
  log = console.error,
}: {
  ownerUid: string;
  run: (ownerUid: string) => Promise<unknown>;
  log?: (...messages: unknown[]) => void;
}): RequestHandler {
  return async (_req, res) => {
    if (res.locals.userUid !== ownerUid) {
      return res.json({
        ok: true,
        report: { skipped: true, reason: 'not_owner_account', ownerUid: res.locals.userUid },
      });
    }
    try {
      const report = await run(res.locals.ownerUid);
      return res.json({ ok: true, report });
    } catch (error) {
      log('Legacy data migration failed:', error);
      return res.status(500).json({
        error: 'Migration failed',
        message: '기존 데이터 복사 검증에 실패했습니다. 원본 데이터는 변경되지 않았습니다.',
        ...(error instanceof MigrationVerificationError ? { failure: error.failure } : {}),
      });
    }
  };
}
