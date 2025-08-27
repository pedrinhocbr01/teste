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

export const localDb = new PouchDB('chatzap');

export function createIndexes() {
  return Promise.all([
    localDb.createIndex({ index: { fields: ['type'] } }),
    localDb.createIndex({ index: { fields: ['type', 'updatedAt'] } }),
    localDb.createIndex({ index: { fields: ['type', 'conversationId', 'createdAt'] } }),
  ]);
}

export async function upsert<T extends { _id: string }>(doc: T): Promise<T> {
  try {
    const existing = await localDb.get<T>(doc._id);
    const res = await localDb.put({ ...existing, ...doc, _rev: (existing as any)._rev });
    return { ...(doc as any), _rev: res.rev };
  } catch (err: any) {
    if (err.status === 404) {
      const res = await localDb.put(doc as any);
      return { ...(doc as any), _rev: res.rev };
    }
    throw err;
  }
}

export async function listConversations(): Promise<Conversation[]> {
  const result = await localDb.find({
    selector: { type: 'conversation' },
    sort: [{ updatedAt: 'desc' } as any],
    limit: 200,
  });
  return (result.docs as unknown as Conversation[]);
}

export async function listMessages(conversationId: string, limit = 200): Promise<Message[]> {
  const result = await localDb.find({
    selector: { type: 'message', conversationId },
    sort: [{ createdAt: 'asc' } as any],
    limit,
  });
  return (result.docs as unknown as Message[]);
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

  await localDb.bulkDocs([convo, ...messages] as any);
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

