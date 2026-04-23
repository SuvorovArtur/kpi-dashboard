import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface TgChat {
  id: number;
  chatId: number;
  title: string;
  username: string | null;
  isActive: boolean;
  type: 'chat' | 'channel';
  subscribers: number;
  userbotId: number | null;
}

export interface TgUserbot {
  id: number;
  label: string;
  sessionName: string;
  phone: string | null;
  apiIdHint: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface TgUserbotDraft {
  id: number;
  label: string;
  sessionName: string;
  apiId: number;
  phone: string;
  status: 'pending' | 'authorized' | 'failed';
  error: string | null;
  createdAt: string;
  authorizedAt: string | null;
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
  const [userbots, setUserbots] = useState<TgUserbot[]>([]);
  const [userbotDrafts, setUserbotDrafts] = useState<TgUserbotDraft[]>([]);
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [issues, setIssues] = useState<TgIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [analysisStatus, setAnalysisStatus] = useState<{
    lastRun: string | null;
    nextRun: string | null;
    queueSize: number;
    lastThreads: number;
    lastAlerts: number;
    status: string;
  }>({ lastRun: null, nextRun: null, queueSize: 0, lastThreads: 0, lastAlerts: 0, status: 'unknown' });

  const [chatCounts, setChatCounts] = useState<Map<number, { total: number; today: number }>>(new Map());

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [chatsRes, msgsRes, issuesRes, countsRes, logRes, queueRes, userbotsRes, draftsRes] = await Promise.all([
      supabase.from('tg_chats').select('*').eq('is_active', true),
      supabase.from('tg_messages').select('*').order('date', { ascending: false }).limit(10),
      supabase.from('tg_issues').select('*').order('last_seen', { ascending: false }),
      supabase.rpc('get_chat_message_counts'),
      supabase.from('tg_analysis_log').select('*').order('started_at', { ascending: false }).limit(1),
      supabase.rpc('get_unanalyzed_messages', { msg_limit: 1 }),
      supabase.from('tg_userbots').select('*').order('created_at', { ascending: true }),
      supabase.from('tg_userbot_drafts').select('*').order('created_at', { ascending: false }),
    ]);

    // Analysis status
    const lastLog = logRes.data?.[0] as any;
    const queueSize = queueRes.count ?? 0;
    if (lastLog) {
      const lastFinished = lastLog.finished_at || lastLog.started_at;
      const nextRun = new Date(new Date(lastFinished).getTime() + 1800000).toISOString();
      setAnalysisStatus({
        lastRun: lastFinished,
        nextRun,
        queueSize,
        lastThreads: lastLog.threads_found ?? 0,
        lastAlerts: lastLog.alerts_found ?? 0,
        status: lastLog.status ?? 'unknown',
      });
    }

    const counts = new Map<number, { total: number; today: number }>();
    if (countsRes.data) {
      for (const r of countsRes.data as any[]) {
        counts.set(r.chat_id, { total: Number(r.total), today: Number(r.today) });
      }
    }
    setChatCounts(counts);

    if (chatsRes.data) setChats(chatsRes.data.map((c: any) => ({
      id: c.id, chatId: c.chat_id, title: c.title, username: c.username, isActive: c.is_active, type: c.type ?? 'chat', subscribers: c.subscribers ?? 0,
      userbotId: c.userbot_id ?? null,
    })));
    if (userbotsRes.data) setUserbots(userbotsRes.data.map((u: any) => ({
      id: u.id, label: u.label, sessionName: u.session_name, phone: u.phone,
      apiIdHint: u.api_id_hint, isActive: u.is_active, lastSeenAt: u.last_seen_at, createdAt: u.created_at,
    })));
    if (draftsRes.data) setUserbotDrafts(draftsRes.data.map((d: any) => ({
      id: d.id, label: d.label, sessionName: d.session_name, apiId: d.api_id, phone: d.phone,
      status: d.status, error: d.error, createdAt: d.created_at, authorizedAt: d.authorized_at,
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

  const addChat = useCallback(async (chatId: number, title: string, username?: string, type: 'chat' | 'channel' = 'chat', userbotId: number | null = null) => {
    await supabase.from('tg_chats').upsert({ chat_id: chatId, title, username, type, userbot_id: userbotId }, { onConflict: 'chat_id' });
    await fetchData();
  }, [fetchData]);

  const setChatUserbot = useCallback(async (chatId: number, userbotId: number | null) => {
    await supabase.from('tg_chats').update({ userbot_id: userbotId }).eq('chat_id', chatId);
    await fetchData();
  }, [fetchData]);

  const saveUserbot = useCallback(async (payload: { id?: number; label: string; sessionName: string; phone?: string | null; apiIdHint?: string | null; isActive?: boolean }) => {
    const row: Record<string, unknown> = {
      label: payload.label,
      session_name: payload.sessionName,
      phone: payload.phone ?? null,
      api_id_hint: payload.apiIdHint ?? null,
      is_active: payload.isActive ?? true,
    };
    if (payload.id) row.id = payload.id;
    const { error } = await supabase.from('tg_userbots').upsert(row, { onConflict: payload.id ? 'id' : 'session_name' });
    await fetchData();
    if (error) throw error;
  }, [fetchData]);

  const deleteUserbot = useCallback(async (id: number) => {
    const { error } = await supabase.from('tg_userbots').delete().eq('id', id);
    await fetchData();
    if (error) throw error;
  }, [fetchData]);

  const createUserbotDraft = useCallback(async (payload: {
    label: string; sessionName: string; apiId: number; apiHash: string; phone: string;
  }) => {
    const { error } = await supabase.from('tg_userbot_drafts').insert({
      label: payload.label,
      session_name: payload.sessionName,
      api_id: payload.apiId,
      api_hash: payload.apiHash,
      phone: payload.phone,
      status: 'pending',
    });
    await fetchData();
    if (error) throw error;
  }, [fetchData]);

  const deleteUserbotDraft = useCallback(async (id: number) => {
    const { error } = await supabase.from('tg_userbot_drafts').delete().eq('id', id);
    await fetchData();
    if (error) throw error;
  }, [fetchData]);

  const removeChat = useCallback(async (chatId: number) => {
    await supabase.from('tg_chats').update({ is_active: false }).eq('chat_id', chatId);
    await fetchData();
  }, [fetchData]);

  const fetchIssueMessages = useCallback(async (issueId: number) => {
    const { data: links } = await supabase
      .from('tg_issue_messages')
      .select('message_id')
      .eq('issue_id', issueId);
    if (!links || links.length === 0) return [];
    const msgIds = links.map((l: any) => l.message_id);
    const { data: msgs } = await supabase
      .from('tg_messages')
      .select('*')
      .in('id', msgIds)
      .order('date', { ascending: true });
    return (msgs ?? []).map((m: any) => ({
      id: m.id, chatId: m.chat_id, messageId: m.message_id, date: m.date,
      senderName: m.sender_name, text: m.text,
    }));
  }, []);

  const updateChatId = useCallback(async (oldChatId: number, newChatId: number) => {
    await supabase.from('tg_chats').update({ chat_id: newChatId }).eq('chat_id', oldChatId);
    await fetchData();
  }, [fetchData]);

  // Fetch full chat stats from DB
  const fetchChatStats = useCallback(async (chatId: number) => {
    const counts = chatCounts.get(chatId);
    const total = counts?.total ?? 0;
    const todayCount = counts?.today ?? 0;

    const [statsRes, recentRes] = await Promise.all([
      supabase.from('tg_messages').select('date, sender_name').eq('chat_id', chatId),
      supabase.from('tg_messages').select('id, chat_id, message_id, date, sender_name, text')
        .eq('chat_id', chatId).order('date', { ascending: false }).limit(5),
    ]);

    const msgs = statsRes.data ?? [];

    // Per day: messages count + unique senders count
    const dayMsgs = new Map<string, number>();
    const daySenders = new Map<string, Set<string>>();
    for (const m of msgs) {
      const day = (m.date as string).slice(0, 10);
      dayMsgs.set(day, (dayMsgs.get(day) ?? 0) + 1);
      if (m.sender_name) {
        if (!daySenders.has(day)) daySenders.set(day, new Set());
        daySenders.get(day)!.add(m.sender_name as string);
      }
    }
    const perDay = Array.from(dayMsgs.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, count]) => ({ date, count, senders: daySenders.get(date)?.size ?? 0 }));

    // Top senders
    const senders = new Map<string, number>();
    for (const m of msgs) {
      const name = m.sender_name as string | null;
      if (name) senders.set(name, (senders.get(name) ?? 0) + 1);
    }
    const topSenders = Array.from(senders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Recent messages
    const recentMessages = (recentRes.data ?? []).map((m: any) => ({
      id: m.id, chatId: m.chat_id, messageId: m.message_id, date: m.date,
      senderName: m.sender_name, text: m.text,
    }));

    return { total, todayCount, perDay, topSenders, recentMessages };
  }, [chatCounts]);

  const fetchChannelNews = useCallback(async (chatId: number) => {
    const { data } = await supabase
      .from('tg_news')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(10);
    return (data ?? []).map((n: any) => ({
      id: n.id,
      chatId: n.chat_id,
      messageId: n.message_id,
      text: n.text,
      photoUrl: n.photo_url,
      summary: n.summary,
      topic: n.topic,
      location: n.location,
      severity: n.severity,
      channelName: n.channel_name,
      postUrl: n.post_url,
      createdAt: n.created_at,
    }));
  }, []);

  const fetchChannelStats = useCallback(async (chatId: number) => {
    const { data } = await supabase
      .from('tg_channel_stats')
      .select('*')
      .eq('chat_id', chatId)
      .order('date', { ascending: true })
      .limit(30);
    return (data ?? []).map((s: any) => ({
      date: s.date,
      subscribers: s.subscribers,
      postsFound: s.posts_found,
    }));
  }, []);

  return { chats, userbots, userbotDrafts, messages, issues, isLoading, chatCounts, analysisStatus, refetch: fetchData, updateIssueStatus, addChat, removeChat, updateChatId, fetchChatStats, fetchIssueMessages, fetchChannelNews, fetchChannelStats, setChatUserbot, saveUserbot, deleteUserbot, createUserbotDraft, deleteUserbotDraft };
}
