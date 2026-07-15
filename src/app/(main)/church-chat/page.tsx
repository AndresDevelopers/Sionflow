'use client';

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { Copy, History, ImagePlus, Loader2, MessageCircle, Mic, Plus, Trash2, Volume2, X } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { firestore } from '@/lib/firebase';
import { compressImageForUpload } from '@/lib/image-compression';
import { getLeadershipLabels } from '@/lib/church-organization-callings';
import logger from '@/lib/logger';
import enTranslations from '@/locales/en.json';
import esTranslations from '@/locales/es.json';

type BrowserSpeechRecognitionResult = {
  readonly isFinal: boolean;
  readonly 0: {
    readonly transcript: string;
  };
};

type BrowserSpeechRecognitionEvent = {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: BrowserSpeechRecognitionResult;
  };
};

type BrowserSpeechRecognitionErrorEvent = {
  readonly error: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  /** Resolved text for user/assistant replies; may be empty when contentKey is set. */
  content: string;
  /** i18n key for system-generated messages (e.g. welcome). Resolved at display time. */
  contentKey?: string;
  /** Optional image attached by the user (data URL). Gemini describes it server-side. */
  imageDataUrl?: string;
  /** True when an image was attached (kept after stripping data URL on persist). */
  hasImage?: boolean;
  createdAt: string;
};

type PendingImage = {
  dataUrl: string;
  name: string;
};

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

type ChatSession = {
  id: string;
  /** Resolved title after the first user message; may be empty when titleKey is set. */
  title: string;
  /** i18n key for default titles (new chat). Resolved at display time. */
  titleKey?: string;
  createdAt: string;
  messages: ChatMessage[];
};

type ChatStoreDocument = {
  sessions?: ChatSession[];
};

const MAX_SESSIONS = 25;
const MAX_MESSAGES_PER_SESSION = 50;

const TITLE_KEY_NEW_CHAT = 'churchChat.nuevoChat';
const CONTENT_KEY_WELCOME = 'churchChat.welcome';

const LEGACY_NEW_CHAT_TITLES = new Set([
  TITLE_KEY_NEW_CHAT,
  enTranslations[TITLE_KEY_NEW_CHAT as keyof typeof enTranslations],
  esTranslations[TITLE_KEY_NEW_CHAT as keyof typeof esTranslations],
]);

const LEGACY_WELCOME_CONTENTS = new Set([
  CONTENT_KEY_WELCOME,
  enTranslations[CONTENT_KEY_WELCOME as keyof typeof enTranslations],
  esTranslations[CONTENT_KEY_WELCOME as keyof typeof esTranslations],
]);

const getSpeechRecognitionConstructor = (): BrowserSpeechRecognitionConstructor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
};

const canUseSpeechSynthesis = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

const speechLocaleForLanguage = (language: string) => (language === 'en' ? 'en-US' : 'es-ES');

/** Spanish gendered prepositions; English uses a fixed "of". */
const getOrgArticle = (
  org: string,
  language: string,
): { article: string; deArticle: string } => {
  if (language === 'en') {
    return { article: '', deArticle: 'of' };
  }
  const lower = org.toLowerCase();
  if (lower.includes('elder') || lower.includes('élder')) return { article: 'el', deArticle: 'del' };
  if (lower.includes('mujeres')) return { article: 'las', deArticle: 'de las' };
  return { article: 'la', deArticle: 'de la' };
};

type QuickOption = {
  key: string;
  /** i18n key for the button label; leadership keys may be overridden by gender-aware labels */
  labelKey: string;
  generateMessage: (
    org: string,
    language: string,
    t: TranslateFn,
  ) => string;
  /** Optional dynamic label (e.g. Presidente / Presidenta by organization) */
  resolveLabel?: (org: string, language: string, t: TranslateFn) => string;
};

const QUICK_OPTIONS: QuickOption[] = [
  {
    key: 'presidente',
    labelKey: 'churchChat.option.presidente',
    resolveLabel: (org, language) =>
      getLeadershipLabels(org, language === 'en' ? 'en' : 'es').president,
    generateMessage: (org, language, t) => {
      const { deArticle } = getOrgArticle(org, language);
      const { president } = getLeadershipLabels(org, language === 'en' ? 'en' : 'es');
      return t('churchChat.prompt.presidente', { deArticle, org, role: president });
    },
  },
  {
    key: 'consejero',
    labelKey: 'churchChat.option.consejero',
    resolveLabel: (org, language) =>
      getLeadershipLabels(org, language === 'en' ? 'en' : 'es').counselor,
    generateMessage: (org, language, t) => {
      const { deArticle } = getOrgArticle(org, language);
      const { counselor } = getLeadershipLabels(org, language === 'en' ? 'en' : 'es');
      return t('churchChat.prompt.consejero', { deArticle, org, role: counselor });
    },
  },
  {
    key: 'secretario',
    labelKey: 'churchChat.option.secretario',
    resolveLabel: (org, language) =>
      getLeadershipLabels(org, language === 'en' ? 'en' : 'es').secretary,
    generateMessage: (org, language, t) => {
      const { deArticle } = getOrgArticle(org, language);
      const { secretary } = getLeadershipLabels(org, language === 'en' ? 'en' : 'es');
      return t('churchChat.prompt.secretario', { deArticle, org, role: secretary });
    },
  },
  {
    key: 'otrosCargos',
    labelKey: 'churchChat.option.otrosCargos',
    generateMessage: (org, language, t) => {
      const { deArticle } = getOrgArticle(org, language);
      const orgName = org.trim() || (language === 'en' ? 'my organization' : 'mi organización');
      return t('churchChat.prompt.otrosCargos', { deArticle, org: orgName });
    },
  },
  {
    key: 'novedades',
    labelKey: 'churchChat.option.novedades',
    generateMessage: (org, language, t) => {
      const { deArticle } = getOrgArticle(org, language);
      return t('churchChat.prompt.novedades', { deArticle, org });
    },
  },
];

const makeInitialAssistantMessage = (): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content: '',
  contentKey: CONTENT_KEY_WELCOME,
  createdAt: new Date().toISOString(),
});

const makeSession = (): ChatSession => ({
  id: crypto.randomUUID(),
  title: '',
  titleKey: TITLE_KEY_NEW_CHAT,
  createdAt: new Date().toISOString(),
  messages: [makeInitialAssistantMessage()],
});

const resolveSessionTitle = (session: ChatSession, t: TranslateFn): string => {
  if (session.titleKey) return t(session.titleKey);
  return session.title || t(TITLE_KEY_NEW_CHAT);
};

const resolveMessageContent = (message: ChatMessage, t: TranslateFn): string => {
  if (message.contentKey) return t(message.contentKey);
  return message.content;
};

/** Migrate legacy sessions that stored resolved ES/EN strings (or raw keys) as content. */
const normalizeMessage = (message: ChatMessage): ChatMessage => {
  if (message.contentKey) {
    return { ...message, content: message.content || '' };
  }
  if (message.role === 'assistant' && LEGACY_WELCOME_CONTENTS.has(message.content)) {
    return {
      ...message,
      content: '',
      contentKey: CONTENT_KEY_WELCOME,
    };
  }
  return message;
};

const normalizeSession = (session: ChatSession): ChatSession => {
  const onlyWelcome =
    session.messages.length === 1 &&
    session.messages[0]?.role === 'assistant' &&
    (Boolean(session.messages[0].contentKey) ||
      LEGACY_WELCOME_CONTENTS.has(session.messages[0].content));

  const looksLikeDefaultTitle =
    Boolean(session.titleKey) ||
    LEGACY_NEW_CHAT_TITLES.has(session.title) ||
    (!session.title && onlyWelcome);

  const titleKey = looksLikeDefaultTitle
    ? session.titleKey ?? TITLE_KEY_NEW_CHAT
    : undefined;

  return {
    ...session,
    titleKey,
    title: titleKey ? '' : session.title,
    messages: session.messages.map(normalizeMessage),
  };
};

const boundSessionMessages = (session: ChatSession): ChatSession => {
  if (session.messages.length <= MAX_MESSAGES_PER_SESSION) return session;
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  };
};

/** Drop large base64 payloads before writing to localStorage / Firestore. */
const stripHeavyImagePayloads = (sessions: ChatSession[]): ChatSession[] =>
  sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (!message.imageDataUrl) return message;
      const { imageDataUrl: _removed, ...rest } = message;
      return { ...rest, hasImage: true };
    }),
  }));

const toBoundedSessions = (sessions: ChatSession[]): ChatSession[] =>
  sessions.slice(0, MAX_SESSIONS).map((session) => boundSessionMessages(normalizeSession(session)));

const getStorageKey = (userId?: string) => `church-chat-sessions-v1-${userId ?? 'guest'}`;

const loadSessionsFromLocal = (storageKey: string): ChatSession[] => {
  if (typeof window === 'undefined') return [makeSession()];

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [makeSession()];

    const parsed = JSON.parse(raw) as ChatSession[];
    return parsed.length > 0 ? toBoundedSessions(parsed) : [makeSession()];
  } catch {
    return [makeSession()];
  }
};

const saveSessionsToLocal = (storageKey: string, sessions: ChatSession[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey, JSON.stringify(stripHeavyImagePayloads(toBoundedSessions(sessions))));
};

const getInlineNodes = (text: string): ReactNode[] => {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`inline-${index}`}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={`inline-${index}`}>{token.slice(1, -1)}</em>;
    }
    return token;
  });
};

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: Array<{ type: 'p'; text: string } | { type: 'ul'; items: string[] }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);

    if (bullet) {
      const current = blocks[blocks.length - 1];
      if (current && current.type === 'ul') {
        current.items.push(bullet[1]);
      } else {
        blocks.push({ type: 'ul', items: [bullet[1]] });
      }
      continue;
    }

    if (!trimmed) {
      blocks.push({ type: 'p', text: '' });
      continue;
    }

    blocks.push({ type: 'p', text: line });
  }

  return (
    <div className="space-y-2 whitespace-pre-wrap">
      {blocks.map((block, index) => {
        if (block.type === 'ul') {
          return (
            <ul key={`block-${index}`} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{getInlineNodes(item)}</li>
              ))}
            </ul>
          );
        }

        if (!block.text) {
          return <div key={`block-${index}`} className="h-2" />;
        }

        return <p key={`block-${index}`}>{getInlineNodes(block.text)}</p>;
      })}
    </div>
  );
}

export default function ChurchChatPage() {
  const { toast } = useToast();
  const { user, firebaseUser, organizacion } = useAuth();
  const { t, language } = useI18n();
  const [sessions, setSessions] = useState<ChatSession[]>(() => [makeSession()]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [showQuickOptions, setShowQuickOptions] = useState(true);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechInputPrefixRef = useRef('');
  const storageKey = useMemo(() => getStorageKey(user?.uid), [user?.uid]);
  const speechLang = speechLocaleForLanguage(language);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );

  const persistSessions = useCallback(async (nextSessions: ChatSession[]) => {
    const bounded = toBoundedSessions(nextSessions);
    const forStorage = stripHeavyImagePayloads(bounded);
    saveSessionsToLocal(storageKey, bounded);

    if (!user?.uid) return;

    try {
      const ref = doc(firestore, 'users', user.uid, 'appData', 'churchChat');
      await setDoc(
        ref,
        {
          sessions: forStorage,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logger.warn({ error, message: 'No fue posible guardar historial de church-chat en Firestore.' });
    }
  }, [storageKey, user?.uid]);

  const updateSessions = (updater: (current: ChatSession[]) => ChatSession[]) => {
    setSessions((current) => {
      const next = toBoundedSessions(updater(current));
      void persistSessions(next);
      return next;
    });
  };

  useEffect(() => {
    const bootstrap = async () => {
      const localSessions = loadSessionsFromLocal(storageKey);
      setSessions(localSessions);

      if (!user?.uid) {
        return;
      }

      try {
        const ref = doc(firestore, 'users', user.uid, 'appData', 'churchChat');
        const snapshot = await getDoc(ref);

        if (!snapshot.exists()) {
          void persistSessions(localSessions);
          return;
        }

        const payload = snapshot.data() as ChatStoreDocument;
        if (Array.isArray(payload.sessions) && payload.sessions.length > 0) {
          const cloudSessions = toBoundedSessions(payload.sessions);
          setSessions(cloudSessions);
          saveSessionsToLocal(storageKey, cloudSessions);
        }
      } catch (error) {
        logger.warn({ error, message: 'Firestore no disponible para church-chat, se mantiene localStorage.' });
      }
    };

    void bootstrap();
  }, [persistSessions, storageKey, user?.uid]);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    requestAnimationFrame(() => scrollToBottom('auto'));
  }, [activeSession?.id, scrollToBottom]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => scrollToBottom(loading ? 'auto' : 'smooth'));
  }, [activeSession?.messages.length, loading, scrollToBottom]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (canUseSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const handleVoiceInput = useCallback(() => {
    if (loading) return;

    const activeRecognition = recognitionRef.current;
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      toast({
        title: t('churchChat.dictadoTitle'),
        description: t('churchChat.dictadoDescription'),
        variant: 'destructive',
      });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = speechLang;
    recognition.interimResults = true;
    recognition.continuous = false;
    speechInputPrefixRef.current = input.trim();

    recognition.onresult = (event) => {
      const transcriptParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        transcriptParts.push(event.results[index][0].transcript.trim());
      }

      const transcript = transcriptParts.filter(Boolean).join(' ').trim();
      setInput([speechInputPrefixRef.current, transcript].filter(Boolean).join(' '));
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        toast({
          title: t('churchChat.listenErrorTitle'),
          description: t('churchChat.listenErrorDescription'),
          variant: 'destructive',
        });
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    try {
      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      toast({
        title: t('churchChat.micError'),
        description: t('churchChat.micErrorDescription'),
        variant: 'destructive',
      });
    }
  }, [input, loading, speechLang, t, toast]);

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast({ title: t('churchChat.copiedTitle'), description: t('churchChat.copiedDescription') });
    } catch {
      toast({
        title: t('churchChat.copyErrorTitle'),
        description: t('churchChat.copyErrorDescription'),
        variant: 'destructive',
      });
    }
  }, [t, toast]);

  const handleSpeakMessage = useCallback((message: ChatMessage) => {
    if (!canUseSpeechSynthesis()) {
      toast({
        title: t('churchChat.speakUnavailableTitle'),
        description: t('churchChat.speakUnavailableDescription'),
        variant: 'destructive',
      });
      return;
    }

    if (speakingMessageId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    const text = resolveMessageContent(message, t);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  }, [speakingMessageId, speechLang, t, toast]);

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImagePick = useCallback(() => {
    if (loading) return;
    fileInputRef.current?.click();
  }, [loading]);

  const handleImageSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file later
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: t('churchChat.imageInvalidTitle'),
        description: t('churchChat.imageInvalidDescription'),
        variant: 'destructive',
      });
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      toast({
        title: t('churchChat.imageTooLargeTitle'),
        description: t('churchChat.imageTooLargeDescription'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const compressed = await compressImageForUpload(file, {
        maxDimension: 1024,
        quality: 0.72,
        maxBytes: 350 * 1024,
        preferWebp: false,
      });
      const dataUrl = await fileToDataUrl(compressed);
      if (!dataUrl.startsWith('data:image/')) {
        throw new Error('invalid data url');
      }
      setPendingImage({ dataUrl, name: file.name });
    } catch {
      toast({
        title: t('churchChat.imageLoadErrorTitle'),
        description: t('churchChat.imageLoadErrorDescription'),
        variant: 'destructive',
      });
    }
  }, [t, toast]);

  const handleNewChat = () => {
    const next = makeSession();
    updateSessions((current) => [next, ...current]);
    setActiveSessionId(next.id);
    setInput('');
    clearPendingImage();
    setShowQuickOptions(true);
  };

  const handleDeleteSession = (sessionId: string) => {
    updateSessions((current) => {
      const filtered = current.filter((session) => session.id !== sessionId);
      if (filtered.length === 0) {
        const replacement = makeSession();
        setActiveSessionId(replacement.id);
        return [replacement];
      }

      if (activeSessionId === sessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  const sendMessage = async (messageText: string, image?: PendingImage | null) => {
    const trimmed = messageText.trim();
    const imageToSend = image ?? pendingImage;
    if ((trimmed.length === 0 && !imageToSend) || loading || !activeSession) return false;

    // API requires min 2 chars when message is present; image-only is allowed without message.
    if (trimmed.length > 0 && trimmed.length < 2 && !imageToSend) return false;

    const messageContent = trimmed;
    const titleFromMessage =
      messageContent.slice(0, 60) ||
      (imageToSend ? t('churchChat.imageMessageTitle') : t(TITLE_KEY_NEW_CHAT));

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageContent,
      imageDataUrl: imageToSend?.dataUrl,
      hasImage: Boolean(imageToSend),
      createdAt: new Date().toISOString(),
    };

    setInput('');
    clearPendingImage();
    setShowQuickOptions(false);
    setLoading(true);

    let draftMessages: ChatMessage[] = [];

    updateSessions((current) =>
      current.map((session) => {
        if (session.id !== activeSession.id) return session;
        draftMessages = [...session.messages, userMessage];
        const isFirstUserTurn = session.messages.length <= 1;
        return {
          ...session,
          title: isFirstUserTurn ? titleFromMessage : session.title,
          titleKey: isFirstUserTurn ? undefined : session.titleKey,
          messages: draftMessages,
        };
      })
    );

    try {
      const history = draftMessages
        .filter((message) => message.id !== userMessage.id)
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: resolveMessageContent(message, t),
        }));

      // Required: server rejects unauthenticated chat (DeepSeek cost control).
      const idToken = await firebaseUser?.getIdToken().catch(() => null);
      if (!idToken) {
        throw new Error(t('churchChat.sendErrorDefault'));
      }
      const response = await fetch('/api/church-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          ...(trimmed.length >= 2 ? { message: trimmed } : {}),
          ...(imageToSend ? { imageDataUrl: imageToSend.dataUrl } : {}),
          history,
          language,
          ...(organizacion ? { organizacion } : {}),
        }),
      });

      const payload = (await response.json()) as { answer?: string; error?: string };

      if (!response.ok || !payload.answer) {
        throw new Error(payload.error ?? t('churchChat.sendErrorDefault'));
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: payload.answer,
        createdAt: new Date().toISOString(),
      };

      updateSessions((current) =>
        current.map((session) => {
          if (session.id !== activeSession.id) return session;
          return {
            ...session,
            messages: [...session.messages, assistantMessage],
          };
        })
      );

      return true;
    } catch (error) {
      toast({
        title: t('churchChat.sendErrorTitle'),
        description: error instanceof Error ? error.message : t('churchChat.sendErrorDefault'),
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    void sendMessage(input.trim(), pendingImage);
  };

  const canSend = !loading && (input.trim().length > 0 || Boolean(pendingImage));

  const handleQuickOption = (option: QuickOption) => {
    void sendMessage(option.generateMessage(organizacion, language, t));
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" /> {t('churchChat.historyTitle')}
          </CardTitle>
          <CardDescription>{t('churchChat.historyDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={handleNewChat}>
            <Plus className="mr-2 h-4 w-4" /> {t('churchChat.nuevoChat')}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {t('churchChat.conversationsCount', { count: sessions.length, max: MAX_SESSIONS })}
          </p>
          <ScrollArea className="h-[420px] rounded-md border p-2">
            <div className="space-y-2">
              {sessions.map((session) => {
                const displayTitle = resolveSessionTitle(session, t);
                return (
                  <div
                    key={session.id}
                    className={`flex items-center gap-2 rounded-md border p-2 transition hover:bg-muted ${
                      activeSession?.id === session.id ? 'border-primary bg-muted' : 'border-border'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSessionId(session.id);
                        setShowQuickOptions(session.messages.length <= 1);
                      }}
                      className="min-h-11 flex-1 text-left"
                    >
                      <p className="line-clamp-1 font-medium text-sm">{displayTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(session.createdAt), 'd MMM yyyy, HH:mm', { locale: getDateFnsLocale() })}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 opacity-100"
                      onClick={() => handleDeleteSession(session.id)}
                      aria-label={t('churchChat.deleteConversationAria', { title: displayTitle })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="h-5 w-5" /> {t('churchChat.chatTitle')}
          </CardTitle>
          <CardDescription>
            {t('churchChat.chatDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="h-[460px] overflow-y-auto rounded-md border p-3">
            <div className="space-y-3">
              {showQuickOptions && (
                <div className="flex flex-wrap gap-2 pb-2">
                  {QUICK_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={loading}
                      onClick={() => handleQuickOption(option)}
                    >
                      {option.resolveLabel
                        ? option.resolveLabel(organizacion, language, t)
                        : t(option.labelKey)}
                    </Button>
                  ))}
                </div>
              )}
              {activeSession?.messages.map((message) => {
                const displayContent = resolveMessageContent(message, t);
                return (
                  <article
                    key={message.id}
                    className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {message.imageDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL preview from user upload
                      <img
                        src={message.imageDataUrl}
                        alt={t('churchChat.imageAlt')}
                        className="mb-2 max-h-48 w-auto max-w-full rounded-md border border-border/40 object-contain"
                      />
                    ) : message.hasImage ? (
                      <p className="mb-2 flex items-center gap-1.5 text-xs opacity-90">
                        <ImagePlus className="h-3.5 w-3.5" />
                        {t('churchChat.imageAttachedLabel')}
                      </p>
                    ) : null}
                    {displayContent ? <FormattedMessage content={displayContent} /> : null}
                    {message.role === 'assistant' && (
                      <div className="mt-2 flex justify-end gap-1 border-t border-border/60 pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          onClick={() => void handleCopyMessage(displayContent)}
                          aria-label={t('churchChat.copyResponseAria')}
                          title={t('churchChat.copyResponseTitle')}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          onClick={() => handleSpeakMessage(message)}
                          aria-label={speakingMessageId === message.id ? t('churchChat.stopReadingAria') : t('churchChat.readResponseAria')}
                          title={speakingMessageId === message.id ? t('churchChat.stopReadingTitle') : t('churchChat.readResponseTitle')}
                        >
                          <Volume2 className={`h-4 w-4 ${speakingMessageId === message.id ? 'text-primary' : ''}`} />
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
              {loading && (
                <article className="max-w-[90%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('churchChat.writing')}</span>
                  </div>
                </article>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {t('churchChat.messagesCount', { count: activeSession?.messages.length ?? 0, max: MAX_MESSAGES_PER_SESSION })}
          </p>

          {pendingImage && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview before send */}
              <img
                src={pendingImage.dataUrl}
                alt={pendingImage.name}
                className="h-14 w-14 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pendingImage.name}</p>
                <p className="text-xs text-muted-foreground">{t('churchChat.imageReadyHint')}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={clearPendingImage}
                disabled={loading}
                aria-label={t('churchChat.removeImageAria')}
                title={t('churchChat.removeImageTitle')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="hidden"
              onChange={(event) => void handleImageSelected(event)}
              disabled={loading}
            />
            <Input
              className="flex-1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                pendingImage
                  ? t('churchChat.inputPlaceholderWithImage')
                  : t('churchChat.inputPlaceholder')
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSend();
                }
              }}
              disabled={loading}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={handleImagePick}
              disabled={loading}
              aria-label={t('churchChat.attachImageAria')}
              title={t('churchChat.attachImageTitle')}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={isListening ? 'secondary' : 'outline'}
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={handleVoiceInput}
              disabled={loading}
              aria-label={isListening ? t('churchChat.stopDictadoAria') : t('churchChat.dictarAria')}
              title={isListening ? t('churchChat.stopDictadoTitle') : t('churchChat.dictarTitle')}
            >
              {isListening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button onClick={handleSend} disabled={!canSend}>
              {t('churchChat.send')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
