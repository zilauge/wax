"use client";

import { useEffect, useState } from "react";
import type {
  Channel,
  ChannelId,
  Conversation,
  WorkspaceContact,
} from "@/app/lib/types";
import { Avatar, ChannelTile, initials } from "@/app/components/shared/ui";
import { SearchIcon } from "@/app/components/shared/icons";
import { searchMessagesAction } from "@/app/lib/search/actions";
import type { MessageHit } from "@/app/lib/search/store";

export type SearchMatches = {
  conversations: Conversation[];
  contacts: WorkspaceContact[];
  channels: Channel[];
};

/**
 * The desk search field and its grouped results. Rendered twice: inline in the
 * header from `md` up, and as a full-width sheet on narrower screens where the
 * header has no room for a field.
 */
export default function DeskSearch({
  variant,
  query,
  needle,
  matches,
  channelMap,
  onQueryChange,
  onOpenConversation,
  onSearchFor,
  onFilterChannel,
  onRunSearch,
  onClear,
  onDismiss,
}: {
  variant: "inline" | "sheet";
  query: string;
  needle: string;
  matches: SearchMatches;
  channelMap: Record<ChannelId, Channel>;
  onQueryChange: (value: string) => void;
  onOpenConversation: (id: string) => void;
  onSearchFor: (name: string) => void;
  onFilterChannel: (id: ChannelId) => void;
  onRunSearch: () => void;
  onClear: () => void;
  onDismiss: () => void;
}) {
  const [hits, setHits] = useState<MessageHit[]>([]);
  const inline = variant === "inline";

  // Message bodies are searched on the server (FTS5) and debounced, so typing
  // does not fire a query per keystroke.
  useEffect(() => {
    if (needle.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      searchMessagesAction(needle)
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needle]);

  // Short queries are not searched, and their old hits must not linger.
  const visibleHits = needle.length >= 2 ? hits : [];
  const count =
    matches.conversations.length +
    matches.contacts.length +
    matches.channels.length +
    visibleHits.length;

  const choose = (select: () => void) => {
    select();
    onDismiss();
  };

  return (
    <div className={inline ? "group relative hidden md:block" : "relative w-full"}>
      <label className="flex items-center gap-2 rounded-xl border border-fg/[0.07] bg-fg/[0.03] px-3 py-2 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-indigo-400/40 focus-within:bg-fg/[0.05]">
        <SearchIcon className="h-4 w-4" />
        <input
          id={inline ? "desk-search-input" : undefined}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClear();
              onDismiss();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onRunSearch();
              onDismiss();
            }
          }}
          autoFocus={!inline}
          placeholder="Search people, topics, channels"
          aria-label="Search people, topics, channels"
          className={`bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none ${
            inline ? "w-56" : "min-w-0 flex-1"
          }`}
        />
        {query && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="rounded p-0.5 text-slate-500 hover:text-fg"
          >
            ×
          </button>
        )}
      </label>

      {needle && (
        <div
          className={
            inline
              ? "absolute right-0 z-30 mt-2 hidden w-80 overflow-hidden rounded-2xl border border-fg/[0.09] bg-[var(--wax-raised)] shadow-[0_30px_60px_-24px_rgba(0,0,0,1)] group-focus-within:block"
              : "mt-2 overflow-hidden rounded-2xl border border-fg/[0.09] bg-[var(--wax-raised)] shadow-[0_30px_60px_-24px_rgba(0,0,0,1)]"
          }
        >
          <ul className="max-h-80 overflow-y-auto">
            {matches.conversations.length > 0 && (
              <li className="wax-eyebrow px-3 pt-2 pb-1">
                Conversations
              </li>
            )}
            {matches.conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => choose(() => onOpenConversation(conversation.id))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-fg/[0.04]"
                >
                  <ChannelTile
                    channel={channelMap[conversation.channel]}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-fg">
                      {conversation.contact.name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {conversation.topic}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {visibleHits.length > 0 && (
              <li className="border-t border-fg/[0.06] wax-eyebrow px-3 pt-2 pb-1">
                Messages
              </li>
            )}
            {visibleHits.map((hit) => (
              <li key={hit.messageId}>
                <button
                  type="button"
                  onClick={() => choose(() => onOpenConversation(hit.conversationId))}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-fg/[0.04]"
                >
                  <ChannelTile channel={channelMap[hit.channel]} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-fg">
                      {hit.contactName}
                    </span>
                    <span className="line-clamp-2 block text-[10px] text-slate-500">
                      {hit.body}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {matches.contacts.length > 0 && (
              <li className="border-t border-fg/[0.06] wax-eyebrow px-3 pt-2 pb-1">
                People
              </li>
            )}
            {matches.contacts.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => choose(() => onSearchFor(contact.name))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-fg/[0.04]"
                >
                  <Avatar
                    initials={initials(contact.name)}
                    color={contact.color}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-fg">
                      {contact.name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {contact.company || contact.handle}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {matches.channels.length > 0 && (
              <li className="border-t border-fg/[0.06] wax-eyebrow px-3 pt-2 pb-1">
                Channels
              </li>
            )}
            {matches.channels.map((channel) => (
              <li key={channel.id}>
                <button
                  type="button"
                  onClick={() => choose(() => onFilterChannel(channel.id))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-fg/[0.04]"
                >
                  <ChannelTile channel={channel} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">
                    {channel.name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {channel.unread} unread
                  </span>
                </button>
              </li>
            ))}

            {count === 0 && needle.length >= 2 && (
              <li className="px-3 py-4 text-center text-[11px] text-slate-500">
                Nothing matches “{query.trim()}”.
              </li>
            )}
          </ul>

          <button
            type="button"
            onClick={() => {
              onRunSearch();
              onDismiss();
            }}
            className="block w-full border-t border-fg/[0.06] px-3 py-2 text-center text-[10px] font-medium text-indigo-400 hover:bg-fg/[0.04] hover:text-indigo-300"
          >
            Open in inbox
          </button>
        </div>
      )}
    </div>
  );
}
