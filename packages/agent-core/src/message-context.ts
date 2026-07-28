import type { ChatMessage } from "@story-forge/model-gateway";

export function trimMessagesToContext(
  messages: ChatMessage[],
  maxTokens: number,
  estimateTokens: (message: ChatMessage) => number = estimateMessageTokens,
): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const rounds = groupConversationRounds(messages.filter((message) => message.role !== "system"));
  const selectedRounds: ChatMessage[][] = [];
  let usedTokens = systemMessages.reduce((total, message) => total + estimateTokens(message), 0);

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (!round) {
      continue;
    }
    const roundTokens = round.reduce((total, message) => total + estimateTokens(message), 0);
    if (usedTokens + roundTokens > maxTokens) {
      break;
    }
    selectedRounds.unshift(round);
    usedTokens += roundTokens;
  }

  return [...systemMessages, ...selectedRounds.flat()];
}

export function estimateMessageTokens(message: ChatMessage): number {
  return Math.ceil(JSON.stringify(message).length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function groupConversationRounds(messages: ChatMessage[]): ChatMessage[][] {
  const rounds: ChatMessage[][] = [];
  let currentRound: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" && currentRound.length > 0) {
      rounds.push(currentRound);
      currentRound = [];
    }
    currentRound.push(message);
  }
  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }
  return rounds;
}
