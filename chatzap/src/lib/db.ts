import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';

PouchDB.plugin(PouchDBFind);

export type Conversation = {
  _id: string; // convo:<uuid>
  type: 'conversation';
  title: string;
  avatarColor?: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
};

export type Message = {
  _id: string; // msg:<uuid>
  type: 'message';
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: number;
  status: 'sent' | 'delivered' | 'read';
};

type Doc = Conversation | Message;

export const localDb = new PouchDB<Doc>('chatzap');

export function createIndexes() {
  return Promise.all([
    localDb.createIndex({ index: { fields: ['type'] } }),
    localDb.createIndex({ index: { fields: ['type', 'updatedAt'] } }),
    localDb.createIndex({ index: { fields: ['type', 'conversationId', 'createdAt'] } }),
  ]);
}

export async function upsert<T extends Doc>(doc: T): Promise<T> {
  const isNotFound = (e: unknown): e is { status: number } =>
    typeof e === 'object' && e !== null && 'status' in e && (e as { status: number }).status === 404;
  try {
    const existing = await localDb.get<T>(doc._id);
    const updated: PouchDB.Core.PutDocument<T> = { ...(existing as T), ...(doc as T), _id: doc._id, _rev: (existing as PouchDB.Core.Document<unknown> & PouchDB.Core.RevisionIdMeta)._rev };
    await localDb.put(updated);
    return doc;
  } catch (err: unknown) {
    if (isNotFound(err)) {
      await localDb.put(doc as PouchDB.Core.PutDocument<T>);
      return doc;
    }
    throw err;
  }
}

export async function listConversations(): Promise<Conversation[]> {
  const sortUpdatedDesc: Record<string, 'asc' | 'desc'> = { updatedAt: 'desc' };
  const result = await localDb.find({
    selector: { type: 'conversation' },
    sort: [sortUpdatedDesc],
    limit: 200,
  });
  const docs = result.docs as Doc[];
  return docs.filter((d): d is Conversation => (d as Conversation).type === 'conversation');
}

export async function listMessages(conversationId: string, limit = 200): Promise<Message[]> {
  const sortCreatedAsc: Record<string, 'asc' | 'desc'> = { createdAt: 'asc' };
  const result = await localDb.find({
    selector: { type: 'message', conversationId },
    sort: [sortCreatedAsc],
    limit,
  });
  const docs = result.docs as Doc[];
  return docs.filter((d): d is Message => (d as Message).type === 'message');
}

export function generateId(prefix: string) {
  const random = crypto.getRandomValues(new Uint32Array(4)).join('');
  return `${prefix}:${Date.now()}:${random}`;
}

export async function seedIfEmpty() {
  const info = await localDb.info();
  if ((info.doc_count ?? 0) > 0) return;

  const conversationId = generateId('convo');
  const now = Date.now();
  const convo: Conversation = {
    _id: conversationId,
    type: 'conversation',
    title: 'Demo Chat',
    avatarColor: '#25d366',
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };
  const messages: Message[] = [
    {
      _id: generateId('msg'),
      type: 'message',
      conversationId,
      senderId: 'me',
      body: 'Olá! Este é um chat local. 🙂',
      createdAt: now - 60000,
      status: 'read',
    },
    {
      _id: generateId('msg'),
      type: 'message',
      conversationId,
      senderId: 'you',
      body: 'Funciona offline e sincroniza com CouchDB.',
      createdAt: now - 30000,
      status: 'read',
    },
  ];

  const docs: Array<PouchDB.Core.PutDocument<Doc>> = [convo, ...messages];
  await localDb.bulkDocs(docs);
}

export function configureSync(remoteUrl?: string) {
  if (!remoteUrl) return undefined;
  const remote = new PouchDB(remoteUrl, { skip_setup: false });
  const syncHandler = localDb.sync(remote, {
    live: true,
    retry: true,
  });
  return syncHandler;
}

