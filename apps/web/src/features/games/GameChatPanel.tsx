/**
 * Slide-in chat panel for an active game. Mobile-first: full-width drawer on
 * narrow screens, fixed sidebar on >= sm. Driven entirely by {@link useGameChat};
 * the page is responsible for `open` / `onClose` and `markAllRead` ergonomics.
 *
 * Phase 5.1 surface:
 *  - Emoji picker is collapsed by default; the input row has a smile toggle.
 *  - Per-message hover bar exposes "reply" + "react" actions.
 *  - Replies render a quote block above the body and (when the target is still
 *    in the visible buffer) clicking the quote scrolls to it.
 *  - Reactions render as chip rows under the bubble; the viewer's chip is
 *    highlighted and clicking it toggles their reaction.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpLeft, Send, Smile, SmilePlus, X } from 'lucide-react';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  EMOJI_REACTIONS,
} from '@durak/shared-types';
import { Button } from '@/components/ui';
import { SocketAckError } from '@/lib/socket';
import { useGameChat } from './hooks';
import type { ChatMessage, ChatMessageReply } from './types';

/**
 * Curated palette of popular emojis, shared with the reactions whitelist on
 * the server. {@link EMOJI_REACTIONS} is the canonical source — re-exporting
 * the same list here keeps the picker and the validator perfectly aligned
 * (and saves an extra import in callers that need the list).
 */
export const QUICK_PICK_EMOJIS: readonly string[] = EMOJI_REACTIONS;

interface GameChatPanelProps {
  gameId: string;
  open: boolean;
  onClose: () => void;
  myUserId: string;
  /**
   * Layout mode. `'drawer'` (default) is the mobile slide-in overlay — chat
   * floats over the table and closes via the X button or backdrop click.
   * `'sidebar'` is the always-visible desktop variant — `open` is treated as
   * `true`, `onClose` is a no-op and the wrapping host (GamePage) decides
   * placement via flex.
   */
  variant?: 'drawer' | 'sidebar';
  /**
   * When `true`, the input composer + reaction actions are hidden — the panel
   * becomes a read-only feed. Used by the spectator UI: any logged-in user
   * may watch and read chat, but only seated participants can post.
   */
  readOnly?: boolean;
}

type EmojiPickerTarget =
  | { kind: 'input' }
  | { kind: 'reaction'; messageId: string };

export function GameChatPanel({
  gameId,
  open,
  onClose,
  myUserId,
  variant = 'drawer',
  readOnly = false,
}: GameChatPanelProps) {
  const { t, i18n } = useTranslation();
  const { messages, send, react, isSending, markAllRead, refresh } = useGameChat(gameId);
  // In sidebar mode the panel is always "open" — there's no drawer toggle.
  // We still expose the same hook surface so tests can pass `open=false` for
  // the drawer variant explicitly.
  const isOpen = variant === 'sidebar' ? true : open;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<ChatMessageReply | null>(null);
  const [picker, setPicker] = useState<EmojiPickerTarget | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const autoStickRef = useRef(true);

  const registerMessageRef = useCallback((id: string, el: HTMLDivElement | null) => {
    const map = messageRefs.current;
    if (!el) {
      map.delete(id);
    } else {
      map.set(id, el);
    }
  }, []);

  // Auto-stick: only follow new messages when the user is already near the
  // bottom. Lets them scroll up to read history without being yanked away.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoStickRef.current = distanceFromBottom < 48;
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (autoStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [isOpen, messages]);

  // On open: refresh from the server (cheap), mark everything seen, focus input.
  // In sidebar mode this fires once on mount; in drawer mode it re-fires on
  // every toggle.
  useEffect(() => {
    if (!isOpen) return;
    markAllRead();
    autoStickRef.current = true;
    void refresh().catch(() => undefined);
    const handle = setTimeout(() => {
      // Avoid stealing focus from the game when the desktop sidebar mounts —
      // the user expects to interact with the table first.
      if (variant !== 'sidebar') {
        inputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(handle);
  }, [isOpen, markAllRead, refresh, variant]);

  // Keep "read" cursor up to date as new messages arrive while the panel is open.
  // Sidebar mode is always visible, so every incoming message is implicitly
  // read the moment it lands.
  useEffect(() => {
    if (isOpen) markAllRead();
  }, [isOpen, messages, markAllRead]);

  const trimmedDraft = draft.trim();
  const remaining = CHAT_MESSAGE_MAX_LENGTH - trimmedDraft.length;
  const tooLong = remaining < 0;
  const canSend = !isSending && trimmedDraft.length > 0 && !tooLong;

  const closePicker = useCallback(() => setPicker(null), []);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setError(null);
    const replyToId = replyDraft?.messageId;
    try {
      await send(draft, replyToId);
      setDraft('');
      setReplyDraft(null);
      closePicker();
      autoStickRef.current = true;
    } catch (err: unknown) {
      if (err instanceof SocketAckError) {
        if (err.code === 'CHAT_RATE_LIMIT') {
          setError(t('game.chat.rateLimit'));
        } else if (err.code === 'CHAT_TEXT_INVALID') {
          setError(t('game.chat.tooLong'));
        } else {
          setError(t(`errors.${err.code}`, { defaultValue: err.message }));
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('errors.generic'));
      }
    }
  }, [canSend, draft, replyDraft, send, closePicker, t]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter to send, Shift+Enter for newline. On mobile the visible keyboard
      // tends to render its own newline button (this maps Enter→submit only
      // when shift isn't held, matching most chat UX).
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const insertEmojiAtCursor = useCallback((emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      setDraft((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setDraft((prev) => prev.slice(0, start) + emoji + prev.slice(end));
    // Restore cursor right after the inserted glyph on the next tick.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* setSelectionRange can throw on detached nodes; safe to ignore */
      }
    });
  }, []);

  const onPickEmoji = useCallback(
    (emoji: string) => {
      const target = picker;
      if (!target) return;
      if (target.kind === 'input') {
        insertEmojiAtCursor(emoji);
        closePicker();
      } else {
        void react(target.messageId, emoji).catch((err) => {
          if (err instanceof SocketAckError) {
            setError(t(`errors.${err.code}`, { defaultValue: err.message }));
          }
        });
        closePicker();
      }
    },
    [picker, insertEmojiAtCursor, react, closePicker, t],
  );

  const onChipClick = useCallback(
    (messageId: string, emoji: string, mine: boolean) => {
      if (readOnly) return;
      // Server-side semantics handle toggle vs override. The optimistic patch
      // inside `react` keeps the UI snappy.
      void react(messageId, mine ? null : emoji).catch((err) => {
        if (err instanceof SocketAckError) {
          setError(t(`errors.${err.code}`, { defaultValue: err.message }));
        }
      });
    },
    [react, t, readOnly],
  );

  const onReply = useCallback(
    (m: ChatMessage) => {
      if (readOnly) return;
      setReplyDraft({
        messageId: m.id,
        userId: m.userId,
        nickname: m.nickname,
        textSnippet: m.text.slice(0, 80),
      });
      setPicker(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [readOnly],
  );

  const onReactRequest = useCallback(
    (messageId: string) => {
      if (readOnly) return;
      setPicker((cur) =>
        cur && cur.kind === 'reaction' && cur.messageId === messageId
          ? null
          : { kind: 'reaction', messageId },
      );
    },
    [readOnly],
  );

  const onToggleEmojiInput = useCallback(() => {
    setPicker((cur) => (cur && cur.kind === 'input' ? null : { kind: 'input' }));
  }, []);

  const scrollToMessage = useCallback((id: string) => {
    const el = messageRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight pulse so the user knows where they landed.
    el.classList.add('chat-quote-flash');
    setTimeout(() => el.classList.remove('chat-quote-flash'), 1200);
  }, []);

  // Esc handler — closes the picker first, then the panel. Drawer-only:
  // pressing Esc on desktop should never collapse the always-visible sidebar.
  useEffect(() => {
    if (!isOpen) return;
    if (variant === 'sidebar') return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picker) {
        setPicker(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, picker, onClose, variant]);

  const groupedMessages = useMemo(() => groupMessages(messages), [messages]);
  const idsInView = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);

  if (!isOpen) return null;

  // The body — message list + error + reply banner + emoji picker + composer —
  // is identical between the drawer and sidebar variants. Hoisting it into a
  // single expression keeps the two render branches focused on their wrapper
  // chrome (overlay vs. inline flex column).
  const body = (
    <>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3"
        data-testid="chat-message-list"
      >
          {messages.length === 0 ? (
            <p
              className="my-auto text-center text-sm text-textMuted"
              data-testid="chat-empty"
            >
              {t('game.chat.empty')}
            </p>
          ) : (
            groupedMessages.map((group) => (
              <ChatMessageGroup
                key={group.firstId}
                group={group}
                myUserId={myUserId}
                lang={i18n.language || 'ru'}
                onReply={onReply}
                onReactRequest={onReactRequest}
                onChipClick={onChipClick}
                onQuoteClick={scrollToMessage}
                idsInView={idsInView}
                registerRef={registerMessageRef}
                activeReactionPicker={
                  picker && picker.kind === 'reaction' ? picker.messageId : null
                }
              />
            ))
          )}
        </div>

        {error ? (
          <div
            className="border-t border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger"
            data-testid="chat-error"
          >
            {error}
          </div>
        ) : null}

        {readOnly ? (
          <div
            className="border-t border-border bg-surfaceAlt px-3 py-2 text-center text-xs text-textMuted"
            data-testid="chat-readonly-notice"
          >
            {t('game.spectator.chatDisabled')}
          </div>
        ) : null}

        {!readOnly && replyDraft ? (
          <div
            className="flex items-start gap-2 border-t border-border bg-surfaceAlt px-3 py-1.5"
            data-testid="chat-reply-banner"
          >
            <div className="min-w-0 flex-1 border-l-2 border-accent pl-2">
              <p className="truncate text-[11px] font-semibold text-accent">
                {t('game.chat.reply.banner', { nickname: replyDraft.nickname })}
              </p>
              <p className="truncate text-[11px] text-textMuted">
                {replyDraft.textSnippet}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplyDraft(null)}
              aria-label={t('game.chat.reply.cancel')}
              className="!h-6 !w-6 !p-0"
              data-testid="chat-reply-cancel"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ) : null}

        {/* Emoji picker — collapsible. Hidden by default; the Smile button or a
            reaction request toggles it. Suppressed in read-only spectator mode. */}
        {picker && !readOnly ? (
          <div
            className="flex max-h-32 flex-wrap gap-0.5 overflow-y-auto border-t border-border bg-surfaceAlt px-2 py-1.5"
            data-testid="chat-emoji-picker"
            role="toolbar"
            aria-label={
              picker.kind === 'reaction'
                ? t('game.chat.react.pickerLabel')
                : t('game.chat.emoji.pickerLabel')
            }
          >
            {QUICK_PICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onPickEmoji(emoji)}
                className="shrink-0 rounded px-1 py-0.5 text-lg leading-none transition-colors hover:bg-border"
                tabIndex={-1}
                aria-label={emoji}
                data-testid={`chat-emoji-${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {readOnly ? null : (
        <form
          className="flex items-end gap-2 border-t border-border px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleEmojiInput}
            aria-label={t('game.chat.emoji.toggle')}
            aria-pressed={picker?.kind === 'input'}
            className="!h-10 !w-10 !p-0"
            data-testid="chat-emoji-toggle"
          >
            <Smile className="h-4 w-4" aria-hidden />
          </Button>
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={onKeyDown}
              maxLength={CHAT_MESSAGE_MAX_LENGTH * 2}
              placeholder={t('game.chat.placeholder')}
              className="block w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-snug focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              data-testid="chat-input"
            />
            {trimmedDraft.length > CHAT_MESSAGE_MAX_LENGTH * 0.8 ? (
              <span
                className={
                  remaining < 0
                    ? 'absolute -top-4 right-1 text-[10px] text-danger'
                    : 'absolute -top-4 right-1 text-[10px] text-textMuted'
                }
              >
                {remaining}
              </span>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSend}
            aria-label={t('game.chat.send')}
            data-testid="chat-send"
            className="!h-10 !w-10 !p-0"
          >
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </form>
        )}
    </>
  );

  // Sidebar variant: render inline, no overlay/backdrop. The host (GamePage)
  // controls placement via a flex layout. No close button — the panel is
  // permanently visible.
  if (variant === 'sidebar') {
    return (
      <aside
        className="flex h-full w-full flex-col border-l border-border bg-surface"
        aria-label={t('game.chat.title')}
        data-testid="game-chat-panel"
        data-variant="sidebar"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{t('game.chat.title')}</h2>
        </header>
        {body}
      </aside>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('game.chat.title')}
      data-testid="game-chat-panel"
      data-variant="drawer"
    >
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full flex-col border-l border-border bg-surface shadow-2xl sm:w-[360px]"
        // Padding-bottom accounts for iOS safe-area / on-screen keyboard.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{t('game.chat.title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="!h-8 !w-8 !p-0"
            data-testid="close-chat"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>
        {body}
      </aside>
    </div>
  );
}

// ---------- internals ----------

interface ChatGroup {
  firstId: string;
  authorId: string;
  nickname: string;
  avatarUrl: string | null;
  items: ChatMessage[];
}

/** Group consecutive messages from the same author within a 2-minute window. */
function groupMessages(messages: ChatMessage[]): ChatGroup[] {
  const out: ChatGroup[] = [];
  const WINDOW_MS = 2 * 60 * 1000;
  for (const m of messages) {
    const last = out[out.length - 1];
    const lastTail = last?.items[last.items.length - 1];
    const gap =
      lastTail !== undefined
        ? Date.parse(m.createdAt) - Date.parse(lastTail.createdAt)
        : Infinity;
    // Replies always start a new group so the quote block has its own
    // breathing room. Otherwise we collapse same-author runs as before.
    if (last && last.authorId === m.userId && gap < WINDOW_MS && !m.replyTo) {
      last.items.push(m);
    } else {
      out.push({
        firstId: m.id,
        authorId: m.userId,
        nickname: m.nickname,
        avatarUrl: m.avatarUrl,
        items: [m],
      });
    }
  }
  return out;
}

interface ChatMessageGroupProps {
  group: ChatGroup;
  myUserId: string;
  lang: string;
  onReply: (m: ChatMessage) => void;
  onReactRequest: (messageId: string) => void;
  onChipClick: (messageId: string, emoji: string, mine: boolean) => void;
  onQuoteClick: (messageId: string) => void;
  idsInView: Set<string>;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  activeReactionPicker: string | null;
}

function ChatMessageGroup({
  group,
  myUserId,
  lang,
  onReply,
  onReactRequest,
  onChipClick,
  onQuoteClick,
  idsInView,
  registerRef,
  activeReactionPicker,
}: ChatMessageGroupProps) {
  const { t } = useTranslation();
  const isMine = group.authorId === myUserId;
  return (
    <div
      className={
        isMine ? 'flex flex-row-reverse items-end gap-2' : 'flex items-end gap-2'
      }
      data-testid={`chat-group-${group.firstId}`}
    >
      {!isMine ? (
        <Avatar nickname={group.nickname} avatarUrl={group.avatarUrl} />
      ) : null}
      <div className={isMine ? 'flex max-w-[80%] flex-col items-end gap-0.5' : 'flex max-w-[80%] flex-col items-start gap-0.5'}>
        {!isMine ? (
          <span className="px-1 text-[11px] font-semibold text-textMuted">
            {group.nickname}
          </span>
        ) : null}
        {group.items.map((m) => {
          const reactions = m.reactions ?? {};
          const reactionGroups = groupReactions(reactions);
          const reactionPickerOpen = activeReactionPicker === m.id;
          return (
            <div
              key={m.id}
              ref={(el) => registerRef(m.id, el)}
              className={isMine ? 'group flex flex-col items-end' : 'group flex flex-col items-start'}
              data-testid={`chat-message-${m.id}`}
            >
              <div
                className={
                  isMine
                    ? 'flex flex-row-reverse items-center gap-1'
                    : 'flex items-center gap-1'
                }
              >
                <div
                  className={
                    isMine
                      ? 'rounded-2xl rounded-br-sm bg-accent px-3 py-1.5 text-sm text-accentText'
                      : 'rounded-2xl rounded-bl-sm bg-surfaceAlt px-3 py-1.5 text-sm text-text'
                  }
                >
                  {m.replyTo ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (m.replyTo && idsInView.has(m.replyTo.messageId)) {
                          onQuoteClick(m.replyTo.messageId);
                        }
                      }}
                      className={
                        isMine
                          ? 'mb-1 block w-full max-w-full rounded border-l-2 border-accentText/60 bg-black/10 px-2 py-1 text-left text-[11px] text-accentText/90 hover:bg-black/20'
                          : 'mb-1 block w-full max-w-full rounded border-l-2 border-accent bg-black/5 px-2 py-1 text-left text-[11px] text-textMuted hover:bg-black/10'
                      }
                      data-testid={`chat-quote-${m.id}`}
                      disabled={!idsInView.has(m.replyTo.messageId)}
                    >
                      <span className="block truncate font-semibold">
                        {m.replyTo.nickname}
                      </span>
                      <span className="block truncate">{m.replyTo.textSnippet}</span>
                    </button>
                  ) : null}
                  <span className="whitespace-pre-wrap break-words">{m.text}</span>
                  <span
                    className={
                      isMine
                        ? 'ml-2 text-[10px] opacity-80'
                        : 'ml-2 text-[10px] text-textMuted'
                    }
                  >
                    {formatRelative(m.createdAt, Date.now(), lang, t)}
                  </span>
                </div>
                {/* Hover action bar — always visible on touch (focus-within),
                    fades in on hover for pointer users. */}
                <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onReply(m)}
                    aria-label={t('game.chat.reply.label')}
                    title={t('game.chat.reply.label')}
                    className="rounded p-1 text-textMuted hover:bg-border"
                    data-testid={`chat-reply-${m.id}`}
                  >
                    <CornerUpLeft className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReactRequest(m.id)}
                    aria-label={t('game.chat.react.add')}
                    aria-pressed={reactionPickerOpen}
                    title={t('game.chat.react.add')}
                    className="rounded p-1 text-textMuted hover:bg-border"
                    data-testid={`chat-react-${m.id}`}
                  >
                    <SmilePlus className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              {reactionGroups.length > 0 ? (
                <div
                  className={
                    isMine
                      ? 'mt-1 flex flex-wrap justify-end gap-1'
                      : 'mt-1 flex flex-wrap gap-1'
                  }
                  data-testid={`chat-reactions-${m.id}`}
                >
                  {reactionGroups.map(({ emoji, count, userIds }) => {
                    const mine = userIds.includes(myUserId);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onChipClick(m.id, emoji, mine)}
                        className={
                          mine
                            ? 'flex items-center gap-1 rounded-full border border-accent bg-accent/20 px-1.5 py-0.5 text-xs text-text'
                            : 'flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs text-textMuted hover:bg-surfaceAlt'
                        }
                        aria-pressed={mine}
                        data-testid={`chat-reaction-chip-${m.id}-${emoji}`}
                      >
                        <span aria-hidden>{emoji}</span>
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
}

/** Group `Record<userId, emoji>` into stable, sorted chip rows. */
function groupReactions(reactions: Record<string, string>): ReactionGroup[] {
  const buckets = new Map<string, string[]>();
  for (const [userId, emoji] of Object.entries(reactions)) {
    let arr = buckets.get(emoji);
    if (!arr) {
      arr = [];
      buckets.set(emoji, arr);
    }
    arr.push(userId);
  }
  // Sort by count desc then emoji alpha to keep chip order stable across renders.
  return [...buckets.entries()]
    .map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

function Avatar({
  nickname,
  avatarUrl,
}: {
  nickname: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={nickname}
        className="h-6 w-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  const initial = (nickname[0] ?? '?').toUpperCase();
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surfaceAlt text-[11px] font-semibold text-textMuted"
      aria-hidden
    >
      {initial}
    </span>
  );
}

/**
 * Cheap dependency-free relative time formatter. We only render the most-recent
 * tail of the chat so absolute precision isn't important — minute granularity
 * is fine and matches what most chat UIs ship.
 */
export function formatRelative(
  iso: string,
  nowMs: number,
  _lang: string,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (diffSec < 60) return t('game.chat.relative.justNow');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) {
    return t('game.chat.relative.minutesAgo', { count: diffMin });
  }
  // Fall back to wall-clock HH:MM for older messages so we don't ship a full
  // date-fns dep for a couple of chat bubbles.
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
