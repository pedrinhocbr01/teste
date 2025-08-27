import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { configureSync, createIndexes, listConversations, listMessages, seedIfEmpty, upsert, type Conversation, type Message, generateId } from './lib/db'

function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const syncRef = useRef<ReturnType<typeof configureSync> | undefined>(undefined)

  useEffect(() => {
    (async () => {
      await createIndexes()
      await seedIfEmpty()
      const convos = await listConversations()
      setConversations(convos)
      setActiveId(convos[0]?._id ?? null)
      if (import.meta.env.VITE_COUCHDB_URL) {
        syncRef.current = configureSync(import.meta.env.VITE_COUCHDB_URL)
      }
    })()
    return () => {
      syncRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    (async () => {
      const msgs = await listMessages(activeId)
      setMessages(msgs)
    })()
  }, [activeId])

  const activeConversation = useMemo(() => conversations.find(c => c._id === activeId) ?? null, [conversations, activeId])

  async function handleSend() {
    if (!activeConversation || !input.trim()) return
    const now = Date.now()
    const msg: Message = {
      _id: generateId('msg'),
      type: 'message',
      conversationId: activeConversation._id,
      senderId: 'me',
      body: input.trim(),
      createdAt: now,
      status: 'sent',
    }
    await upsert<Message>(msg)
    const updated: Conversation = { ...activeConversation, updatedAt: now, lastMessageAt: now }
    await upsert<Conversation>(updated)
    setInput('')
    const msgs = await listMessages(activeConversation._id)
    setMessages(msgs)
    const convos = await listConversations()
    setConversations(convos)
  }

  return (
    <div className="h-screen w-screen grid md:grid-cols-[380px_1fr] grid-cols-1">
      <aside className="hidden md:flex flex-col border-r border-neutral-800 bg-neutral-950">
        <div className="p-4 border-b border-neutral-800">
          <h1 className="text-lg font-semibold">Chatzap</h1>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-neutral-900">
          {conversations.map(c => (
            <button key={c._id} onClick={() => setActiveId(c._id)} className={`w-full text-left p-4 hover:bg-neutral-900 ${activeId===c._id ? 'bg-neutral-900' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full shrink-0" style={{ backgroundColor: c.avatarColor ?? '#2a2a2a' }} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.title}</div>
                  <div className="text-xs text-neutral-400">Atualizado {new Date(c.updatedAt).toLocaleTimeString()}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-neutral-800 text-xs text-neutral-500">
          {import.meta.env.VITE_COUCHDB_URL ? 'Sincronização ativada' : 'Somente local'}
        </div>
      </aside>

      <main className="flex flex-col bg-neutral-900">
        <div className="md:hidden p-3 border-b border-neutral-800">
          <select className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 w-full" value={activeId ?? ''} onChange={e=>setActiveId(e.target.value)}>
            {conversations.map(c => (
              <option key={c._id} value={c._id}>{c.title}</option>
            ))}
          </select>
        </div>
        <header className="p-4 border-b border-neutral-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full" style={{ backgroundColor: activeConversation?.avatarColor ?? '#2a2a2a' }} />
          <div className="font-medium">{activeConversation?.title ?? '—'}</div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {messages.map(m => (
            <div key={m._id} className={`max-w-[75%] md:max-w-[60%] rounded-2xl px-3 py-2 ${m.senderId==='me' ? 'ml-auto bg-emerald-600 text-white' : 'mr-auto bg-neutral-800'} `}>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className="text-[10px] opacity-70 text-right mt-1">{new Date(m.createdAt).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-neutral-800 flex items-center gap-2">
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') handleSend() }} placeholder="Mensagem" className="flex-1 bg-neutral-800 border border-neutral-700 rounded-full px-4 py-2 outline-none" />
          <button onClick={handleSend} className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2">Enviar</button>
        </div>
      </main>
    </div>
  )
}

export default ChatApp
