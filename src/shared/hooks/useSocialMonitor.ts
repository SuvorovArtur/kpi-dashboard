import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface TgChat {
  id: number;
  chatId: number;
  title: string;
  username: string | null;
  isActive: boolean;
}

export interface TgMessage {
  id: number;
  chatId: number;
  messageId: number;
  date: string;
  senderName: string | null;
  text: string;
  replyToId: number | null;
}

export interface TgIssue {
  id: number;
  title: string;
  summary: string | null;
  severity: number;
  status: 'new' | 'watching' | 'escalated' | 'resolved' | 'ignored';
  messageCount: number;
  firstSeen: string;
  lastSeen: string;
  direction: string | null;
  location: string | null;
}

export function useSocialMonitor() {
  const [chats, setChats] = useState<TgChat[]>([]);
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [issues, setIssues] = useState<TgIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [chatsRes, msgsRes, issuesRes] = await Promise.all([
      supabase.from('tg_chats').select('*').eq('is_active', true),
      supabase.from('tg_messages').select('*').order('date', { ascending: false }).limit(100),
      supabase.from('tg_issues').select('*').order('last_seen', { ascending: false }),
    ]);

    if (chatsRes.data) setChats(chatsRes.data.map((c: any) => ({
      id: c.id, chatId: c.chat_id, title: c.title, username: c.username, isActive: c.is_active,
    })));
    if (msgsRes.data) setMessages(msgsRes.data.map((m: any) => ({
      id: m.id, chatId: m.chat_id, messageId: m.message_id, date: m.date,
      senderName: m.sender_name, text: m.text, replyToId: m.reply_to_id,
    })));
    if (issuesRes.data) setIssues(issuesRes.data.map((i: any) => ({
      id: i.id, title: i.title, summary: i.summary, severity: i.severity,
      status: i.status, messageCount: i.message_count,
      firstSeen: i.first_seen, lastSeen: i.last_seen,
      direction: i.direction, location: i.location,
    })));
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateIssueStatus = useCallback(async (id: number, status: TgIssue['status']) => {
    await supabase.from('tg_issues').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    await fetchData();
  }, [fetchData]);

  const addChat = useCallback(async (chatId: number, title: string, username?: string) => {
    await supabase.from('tg_chats').upsert({ chat_id: chatId, title, username }, { onConflict: 'chat_id' });
    await fetchData();
  }, [fetchData]);

  const removeChat = useCallback(async (chatId: number) => {
    await supabase.from('tg_chats').update({ is_active: false }).eq('chat_id', chatId);
    await fetchData();
  }, [fetchData]);

  // Chat statistics helper
  const getChatStats = useCallback((chatId: number) => {
    const chatMsgs = messages.filter(m => m.chatId === chatId);
    const total = chatMsgs.length;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = chatMsgs.filter(m => m.date.startsWith(today)).length;

    // Messages per day (last 7 days)
    const days = new Map<string, number>();
    for (const m of chatMsgs) {
      const day = m.date.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    const perDay = Array.from(days.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, count]) => ({ date, count }));

    // Top senders
    const senders = new Map<string, number>();
    for (const m of chatMsgs) {
      if (m.senderName) senders.set(m.senderName, (senders.get(m.senderName) ?? 0) + 1);
    }
    const topSenders = Array.from(senders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return { total, todayCount, perDay, topSenders };
  }, [messages]);

  return { chats, messages, issues, isLoading, refetch: fetchData, updateIssueStatus, addChat, removeChat, getChatStats };
}
