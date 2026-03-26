import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getStorage, ref, uploadString, getDownloadURL, uploadBytes } from 'firebase/storage';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

type DatabaseRef = { kind: 'database' };
type CollectionRef = { kind: 'collection'; path: [string] };
type DocumentRef = { kind: 'document'; path: [string, string]; id: string };
type QueryConstraint =
  | { type: 'where'; field: string; operator: string; value: unknown }
  | { type: 'orderBy'; field: string; direction: 'asc' | 'desc' }
  | { type: 'limit'; count: number }
  | { type: 'startAfter'; cursor: { id: string; data: Record<string, unknown> } };
type QueryRef = {
  kind: 'query';
  collection: CollectionRef;
  constraints: QueryConstraint[];
};

type ArrayOperation =
  | { __op: 'arrayUnion'; values: unknown[] }
  | { __op: 'arrayRemove'; values: unknown[] };

interface SnapshotDoc<T = any> {
  id: string;
  data(): T;
  exists(): boolean;
  __cursor: { id: string; data: T };
}

interface QuerySnapshot<T = any> {
  docs: SnapshotDoc<T>[];
  size: number;
}

interface DocumentSnapshot<T = any> {
  id: string;
  data(): T;
  exists(): boolean;
}

export const db: DatabaseRef = { kind: 'database' };

const POLL_INTERVAL_MS = 5000;

function createId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function collectionNameFromRef(ref: CollectionRef | DocumentRef) {
  return ref.path[0];
}

function documentIdFromRef(ref: DocumentRef) {
  return ref.path[1];
}

async function dbRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Database request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeForTransport(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeForTransport);

  if (value && typeof value === 'object') {
    if (value.__op === 'arrayUnion' || value.__op === 'arrayRemove') {
      return {
        __op: value.__op,
        values: normalizeForTransport(value.values),
      };
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalizeForTransport(entry)])
    );
  }

  return value;
}

function createDocumentSnapshot<T = any>(raw: T | null, id: string): DocumentSnapshot<T> {
  return {
    id,
    data: () => {
      if (!raw) return raw as T;
      const { id: _id, ...rest } = raw as any;
      return clone(rest as T);
    },
    exists: () => raw !== null,
  };
}

function createQueryDocSnapshot<T = any>(raw: T & { id: string }): SnapshotDoc<T> {
  return {
    id: raw.id,
    data: () => {
      const { id: _id, ...rest } = raw as any;
      return clone(rest as T);
    },
    exists: () => true,
    __cursor: { id: raw.id, data: clone(raw) },
  };
}

export function collection(parent: DatabaseRef, name: string): CollectionRef {
  return { kind: 'collection', path: [name] };
}

export function doc(parent: DatabaseRef | CollectionRef, collectionName?: string, documentId?: string): DocumentRef {
  if ((parent as CollectionRef).kind === 'collection') {
    const collectionRef = parent as CollectionRef;
    const id = collectionName ?? createId();
    return {
      kind: 'document',
      path: [collectionRef.path[0], id],
      id,
    };
  }

  if (!collectionName || !documentId) {
    throw new Error('Document references require a collection name and document id.');
  }

  return {
    kind: 'document',
    path: [collectionName, documentId],
    id: documentId,
  };
}

export function where(field: string, operator: string, value: unknown): QueryConstraint {
  return { type: 'where', field, operator, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: 'limit', count };
}

export function startAfter(snapshot: SnapshotDoc): QueryConstraint {
  return { type: 'startAfter', cursor: snapshot.__cursor };
}

export function query(source: CollectionRef | QueryRef, ...constraints: QueryConstraint[]): QueryRef {
  if (source.kind === 'query') {
    return {
      kind: 'query',
      collection: source.collection,
      constraints: [...source.constraints, ...constraints],
    };
  }

  return {
    kind: 'query',
    collection: source,
    constraints,
  };
}

export async function getDoc<T = any>(ref: DocumentRef): Promise<DocumentSnapshot<T>> {
  const result = await dbRequest<{ document: T | null }>('/api/db/get-doc', {
    collection: collectionNameFromRef(ref),
    id: documentIdFromRef(ref),
  });

  return createDocumentSnapshot(result.document, ref.id);
}

export async function getDocs<T = any>(source: CollectionRef | QueryRef): Promise<QuerySnapshot<T>> {
  const queryRef = source.kind === 'query' ? source : query(source);
  const result = await dbRequest<{ documents: (T & { id: string })[] }>('/api/db/get-docs', {
    collection: queryRef.collection.path[0],
    constraints: normalizeForTransport(queryRef.constraints),
  });

  const docs = result.documents.map(createQueryDocSnapshot);
  return { docs, size: docs.length };
}

export async function setDoc(ref: DocumentRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
  await dbRequest('/api/db/set-doc', {
    collection: collectionNameFromRef(ref),
    id: documentIdFromRef(ref),
    data: normalizeForTransport(data),
    merge: options?.merge === true,
  });
}

export async function updateDoc(ref: DocumentRef, data: Record<string, unknown>) {
  await dbRequest('/api/db/update-doc', {
    collection: collectionNameFromRef(ref),
    id: documentIdFromRef(ref),
    data: normalizeForTransport(data),
  });
}

export async function deleteDoc(ref: DocumentRef) {
  await dbRequest('/api/db/delete-doc', {
    collection: collectionNameFromRef(ref),
    id: documentIdFromRef(ref),
  });
}

export async function addDoc(ref: CollectionRef, data: Record<string, unknown>) {
  const result = await dbRequest<{ id: string }>('/api/db/add-doc', {
    collection: collectionNameFromRef(ref),
    data: normalizeForTransport(data),
  });

  return {
    kind: 'document' as const,
    path: [ref.path[0], result.id] as [string, string],
    id: result.id,
  };
}

export function onSnapshot<T = any>(
  target: DocumentRef | CollectionRef | QueryRef,
  onNext: ((snapshot: DocumentSnapshot<T>) => void) | ((snapshot: QuerySnapshot<T>) => void),
  onError?: (error: unknown) => void
) {
  let active = true;

  const run = async () => {
    try {
      if (!active) return;
      if (target.kind === 'document') {
        const snapshot = await getDoc<T>(target);
        if (active) (onNext as (snapshot: DocumentSnapshot<T>) => void)(snapshot);
        return;
      }

      const snapshot = await getDocs<T>(target);
      if (active) (onNext as (snapshot: QuerySnapshot<T>) => void)(snapshot);
    } catch (error) {
      if (active) onError?.(error);
    }
  };

  run();
  const intervalId = window.setInterval(run, POLL_INTERVAL_MS);

  return () => {
    active = false;
    window.clearInterval(intervalId);
  };
}

export function arrayUnion(...values: unknown[]): ArrayOperation {
  return { __op: 'arrayUnion', values };
}

export function arrayRemove(...values: unknown[]): ArrayOperation {
  return { __op: 'arrayRemove', values };
}

export function writeBatch(_db: DatabaseRef) {
  const operations: Array<Record<string, unknown>> = [];

  return {
    update(ref: DocumentRef, data: Record<string, unknown>) {
      operations.push({
        type: 'update',
        collection: collectionNameFromRef(ref),
        id: documentIdFromRef(ref),
        data: normalizeForTransport(data),
      });
    },
    delete(ref: DocumentRef) {
      operations.push({
        type: 'delete',
        collection: collectionNameFromRef(ref),
        id: documentIdFromRef(ref),
      });
    },
    async commit() {
      await dbRequest('/api/db/batch', { operations });
    },
  };
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, shouldThrow = false) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Database Error: ', JSON.stringify(errInfo));
  if (shouldThrow) {
    throw new Error(JSON.stringify(errInfo));
  }
  return errInfo;
}

export { signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword };
export { ref, uploadString, getDownloadURL, uploadBytes };
